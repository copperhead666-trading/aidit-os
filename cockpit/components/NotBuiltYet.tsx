import { PageHeader } from "@/components/PageHeader";
import { Label } from "@/components/terminal";

interface NotBuiltYetProps {
  title: string;
  plannedSource: string;
}

export function NotBuiltYet({ title, plannedSource }: NotBuiltYetProps) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="mt-4 border border-os-border bg-os-surface px-4 py-5 sm:px-6">
        <Label>NOT BUILT YET</Label>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-os-muted">
          This view has no implementation yet. When built, it will read from{" "}
          <span className="text-os-text">{plannedSource}</span>.
        </p>
      </div>
    </div>
  );
}
