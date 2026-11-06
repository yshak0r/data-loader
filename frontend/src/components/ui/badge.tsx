import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring select-none',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary:
          'border-border/80 bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
        outline: 'text-foreground border-border bg-transparent',
        success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        warning: 'border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-400',
        info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
        purple: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
