import { UserProfile } from "../../types";
import { AppSettings } from "../../types";
import { ClipboardList } from "lucide-react";
import SheetModuleBase, { SheetTab } from "./SheetModuleBase";

interface TabelModuleProps {
  user: UserProfile;
  settings?: AppSettings;
}

export default function TabelModule({ user, settings }: TabelModuleProps) {
  const sheetUrl = settings?.tabelSheetUrl || "";
  const tabs: SheetTab[] = sheetUrl
    ? [{ id: "main", name: "Табель", sheetUrl }]
    : [];

  return (
    <SheetModuleBase
      user={user}
      moduleKey="tabel"
      title="Табель"
      subtitle="Учёт рабочего времени"
      icon={ClipboardList}
      iconWrapClass="bg-emerald-500/10 border-emerald-500/20"
      iconColorClass="text-emerald-600"
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