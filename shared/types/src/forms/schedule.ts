import { z } from 'zod';

/**
 * Shared schedule-form schemas. Imported by both the client (RHF resolver in
 * SchedulerView) and the server (`/api/schedules/[cadence]`) so the same
 * validation rules apply at both ends.
 *
 * Three cadences with distinct cadence-value fields, expressed as a
 * discriminated union on the `cadence` literal.
 */

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use HH:mm' });

const dayOfWeek = z.number().int().min(0).max(6);

const dayOfMonth = z.union([
  z.literal('last'),
  z.literal('last-business'),
  z.string().regex(/^\d{1,2}$/, { message: 'Invalid day of month' }),
]);

const recipients = z
  .array(z.string().email({ message: 'Invalid email address' }))
  .min(1, { message: 'At least one recipient' })
  .max(6, { message: 'Up to 6 recipients' });

export const dailyScheduleSchema = z.object({
  cadence: z.literal('daily'),
  timeLocal: time,
  recipients,
  enabled: z.boolean().default(true),
});

export const weeklyScheduleSchema = z.object({
  cadence: z.literal('weekly'),
  dayOfWeek,
  timeLocal: time,
  recipients,
  enabled: z.boolean().default(true),
});

export const monthlyScheduleSchema = z.object({
  cadence: z.literal('monthly'),
  dayOfMonth,
  timeLocal: time,
  recipients,
  enabled: z.boolean().default(true),
});

export const scheduleSchema = z.discriminatedUnion('cadence', [
  dailyScheduleSchema,
  weeklyScheduleSchema,
  monthlyScheduleSchema,
]);

export type DailyScheduleValues = z.infer<typeof dailyScheduleSchema>;
export type WeeklyScheduleValues = z.infer<typeof weeklyScheduleSchema>;
export type MonthlyScheduleValues = z.infer<typeof monthlyScheduleSchema>;
export type ScheduleValues = z.infer<typeof scheduleSchema>;
