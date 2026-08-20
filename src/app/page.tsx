import { LocaleProvider } from "@/components/locale-provider";
import { WorkspaceActivationRoot } from "@/components/multi-assignment-workspace/workspace-activation-root";

export default function Home() {
  return (
    <LocaleProvider>
      <WorkspaceActivationRoot />
    </LocaleProvider>
  );
}
