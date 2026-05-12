import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-white shadow-[0_2px_8px_-2px_rgba(200,133,78,0.4)] hover:bg-accent/90 hover:shadow-[0_4px_14px_-2px_rgba(200,133,78,0.5)]',
        secondary:
          'border border-border bg-bg-card text-text-primary hover:border-accent/40 hover:bg-bg-base shadow-[0_1px_2px_0_rgba(31,27,22,0.04)]',
        ghost: 'text-text-secondary hover:bg-bg-card hover:text-text-primary',
        link: 'text-accent underline-offset-4 hover:underline px-0 shadow-none',
        destructive:
          'bg-heat-critical text-white shadow-[0_2px_8px_-2px_rgba(176,46,46,0.4)] hover:bg-heat-critical/90 hover:shadow-[0_4px_14px_-2px_rgba(176,46,46,0.5)]',
      },
      size: {
        sm: 'h-8 px-4 text-xs',
        md: 'h-10 px-5 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
