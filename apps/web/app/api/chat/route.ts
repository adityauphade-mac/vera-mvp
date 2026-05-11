import { openai } from '@ai-sdk/openai';
import { convertToCoreMessages, streamText, tool } from 'ai';
import { z } from 'zod';
import { getData } from '@/lib/data';
import { generateFollowUpDraft } from '@vera/domain';
import { withAuth } from '@/lib/auth-helpers';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are Vera Calloway — Lead AR Intelligence Specialist for Priority Roofs.

VOICE
- Warm, composed, lightly editorial. Like a senior controller catching up with a colleague.
- Never alarmist. Critical signals get presence without panic.
- Numbers come with context, never dumped.
- Use Vera's first person ("I'm watching..." / "I'd nudge Mike...").

SCOPE
- You only discuss accounts receivable for Priority Roofs.
- For off-topic questions, gently redirect ("That's outside my AR remit, but I can show you...").
- Never invent jobs, reps, or numbers. Use the tools to ground every claim.

DATA YOU HAVE
- ~130 jobs in active AR (installed + balance > 0).
- Each job has: address, customer name, rep, install date, balance, heat score (0–100), aging bucket, anomalies, missing milestones.
- Heat bands: cool (0-25), warm (26-50), hot (51-75), critical (76+ → executive review queue).

WHEN ASKED FOR EMAIL DRAFTS
- Use the draftFollowUp tool. Don't write emails freehand.
- Never claim to have sent an email — drafts only.

FORMAT
- Default to short, conversational paragraphs.
- Use lists only when comparing multiple items.
- One pithy summary line is often enough.`;

export async function POST(req: Request) {
  return withAuth(async (audit) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }

    const body = await req.json();
    const messages = convertToCoreMessages(body.messages ?? []);

    // Audit the user's question up front. We don't wait for the stream
    // to complete because (a) streaming makes a clean post-completion
    // hook awkward and (b) the value is recording the INTENT (what
    // they asked Vera), not the response text.
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user');
    const lastUserText =
      typeof lastUserMessage?.content === 'string'
        ? lastUserMessage.content
        : Array.isArray(lastUserMessage?.content)
          ? lastUserMessage.content
              .filter((p) => p.type === 'text')
              .map((p) => ('text' in p ? p.text : ''))
              .join(' ')
          : '';
    const summaryText =
      lastUserText.length > 120
        ? lastUserText.slice(0, 117) + '...'
        : lastUserText || '(no text)';

    await recordAudit(db, {
      tenantId: audit.tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'chat',
      action: 'asked',
      summary: `Asked Vera: "${summaryText}"`,
      details: {
        // Full message thread — useful for reconstructing the conversation
        // in the detail sheet. May contain sensitive content; access is
        // gated by tenant.
        messages: body.messages ?? [],
        model: 'gpt-4o-mini',
      },
    });

    const result = streamText({
      model: openai('gpt-4o-mini'),
      system: SYSTEM_PROMPT,
      messages,
      tools: {
        getJob: tool({
          description: 'Fetch a single AR job by id.',
          parameters: z.object({ id: z.number() }),
          execute: async ({ id }) => {
            const job = getData().jobs.find((j) => j.id === id);
            return job ?? { error: 'not_found' };
          },
        }),
        listJobs: tool({
          description:
            'List AR jobs. Optional filters: heatBand, repName (case-insensitive substring), agingBucket, fellThroughCracks.',
          parameters: z.object({
            heatBand: z.enum(['cool', 'warm', 'hot', 'critical']).optional(),
            repName: z.string().optional(),
            agingBucket: z
              .enum(['within-terms', '1-30-past', '31-60-past', '60-plus-past'])
              .optional(),
            fellThroughCracks: z.boolean().optional(),
            limit: z.number().min(1).max(50).optional(),
          }),
          execute: async ({ heatBand, repName, agingBucket, fellThroughCracks, limit }) => {
            let jobs = getData().jobs;
            if (heatBand) jobs = jobs.filter((j) => j.heatBand === heatBand);
            if (agingBucket) jobs = jobs.filter((j) => j.agingBucket === agingBucket);
            if (typeof fellThroughCracks === 'boolean') {
              jobs = jobs.filter((j) => j.fellThroughCracks === fellThroughCracks);
            }
            if (repName) {
              const needle = repName.toLowerCase();
              jobs = jobs.filter((j) => j.rep?.name?.toLowerCase().includes(needle));
            }
            jobs = [...jobs].sort((a, b) => b.heatScore - a.heatScore);
            return jobs.slice(0, limit ?? 10).map((j) => ({
              id: j.id,
              address: j.address,
              customerName: j.customerName,
              rep: j.rep?.name,
              region: j.region,
              isInsurance: j.isInsurance,
              balance: j.balance,
              daysPastTerms: j.daysPastTerms,
              heatScore: j.heatScore,
              heatBand: j.heatBand,
              anomalies: j.anomalies,
              missingMilestones: j.missingMilestones,
              fellThroughCracks: j.fellThroughCracks,
            }));
          },
        }),
        getRep: tool({
          description: 'Get a rep summary by name (case-insensitive substring match).',
          parameters: z.object({ name: z.string() }),
          execute: async ({ name }) => {
            const needle = name.toLowerCase();
            const rep = getData().reps.find((r) => r.rep.name.toLowerCase().includes(needle));
            return rep ?? { error: 'not_found' };
          },
        }),
        draftFollowUp: tool({
          description: 'Draft a follow-up email for a job by id. Returns subject and body.',
          parameters: z.object({ jobId: z.number() }),
          execute: async ({ jobId }) => {
            const job = getData().jobs.find((j) => j.id === jobId);
            if (!job) return { error: 'job_not_found' };
            return generateFollowUpDraft(job);
          },
        }),
      },
      maxSteps: 5,
    });

    return result.toDataStreamResponse();
  });
}
