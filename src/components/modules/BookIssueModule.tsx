import { UserProfile } from "../../types";
import { AppSettings } from "../../types";
import { BookOpen } from "lucide-react";
import SheetModuleBase, { SheetTab } from "./SheetModuleBase";

interface BookIssueModuleProps {
  user: UserProfile;
  settings?: AppSettings;
}

export default function BookIssueModule({ user, settings }: BookIssueModuleProps) {
  const sheetUrl = settings?.bookIssueSheetUrl || "";
  const tabs: SheetTab[] = sheetUrl
    ? [{ id: "main", name: "Книга выдачи", sheetUrl }]
    : [];

  return (
    <SheetModuleBase
      user={user}
      moduleKey="bookIssue"
      title="Книга выдачи"
      subtitle="Учет выданных документов"
      icon={BookOpen}
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