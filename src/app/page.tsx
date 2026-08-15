import { RubricTrailApp } from "@/components/rubrictrail-app";
import { LocaleProvider } from "@/components/locale-provider";

export default function Home() {
  return (
    <LocaleProvider>
      <RubricTrailApp />
    </LocaleProvider>
  );
}
