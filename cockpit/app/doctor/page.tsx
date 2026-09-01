import { NotBuiltYet } from "@/components/NotBuiltYet";

export default function DoctorPage() {
  return (
    <NotBuiltYet
      title="Doctor"
      plannedSource="ops-watcher/heartbeat-steps.jsonl and ops-watcher/self-repair-log.jsonl"
    />
  );
}
