import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-medium tracking-wide uppercase",
  {
    variants: {
      variant: {
        muted: "bg-muted text-muted-foreground",
        keep: "bg-keep-dim text-keep",
        drop: "bg-drop-dim text-drop",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { variant: "muted" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
