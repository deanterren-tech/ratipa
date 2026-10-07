import { UserProfile } from "../../types";
import { AppSettings } from "../../types";
import { BookCheck } from "lucide-react";
import SheetModuleBase, { SheetTab } from "./SheetModuleBase";

interface BookIssueRRModuleProps {
  user: UserProfile;
  settings?: AppSettings;
}

export default function BookIssueRRModule({ user, settings }: BookIssueRRModuleProps) {
  const sheetUrl = settings?.bookIssueRRUrl || "";
  const tabs: SheetTab[] = sheetUrl
    ? [{ id: "main", name: "Книга выдачи РР", sheetUrl }]
    : [];

  return (
    <SheetModuleBase
      user={user}
      moduleKey="bookIssueRR"
      title="Книга выдачи РР"
      subtitle="Учет выданных документов РР"
      icon={BookCheck}
      tabs={tabs}
      gpsUrls={{
        beltranssputnik: settings?.gpsBeltranssputnikUrl || "",
        wialon: settings?.gpsWialonUrl || "",
        era_glonass: settings?.gpsEraGlonassUrl || "",
      }}
      gpsEnabled={false}
      showTabs={false}
    />
  );
}
