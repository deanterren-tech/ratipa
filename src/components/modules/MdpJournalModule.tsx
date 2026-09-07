import { UserProfile } from "../../types";
import { AppSettings } from "../../types";
import { FileText } from "lucide-react";
import SheetModuleBase, { SheetTab } from "./SheetModuleBase";

interface MdpJournalModuleProps {
  user: UserProfile;
  settings?: AppSettings;
}

export default function MdpJournalModule({ user, settings }: MdpJournalModuleProps) {
  const sheetUrl = settings?.mdpJournalSheetUrl || "";
  const tabs: SheetTab[] = sheetUrl
    ? [{ id: "main", name: "Журнал МДП", sheetUrl }]
    : [];

  return (
    <SheetModuleBase
      user={user}
      moduleKey="mdpJournal"
      title="Журнал МДП"
      subtitle="Учёт книжек МДП"
      icon={FileText}
      iconWrapClass="bg-amber-500/10 border-amber-500/20"
      iconColorClass="text-amber-600"
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