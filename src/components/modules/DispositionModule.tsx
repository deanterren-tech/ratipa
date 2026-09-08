import { useState, useEffect } from "react";
import { dbService } from "../../api";
import { AppSettings, UserProfile } from "../../types";
import { Map } from "lucide-react";
import SheetModuleBase, { SheetTab } from "./SheetModuleBase";

type GpsTab = "beltranssputnik" | "wialon" | "era_glonass";

export default function DispositionModule({ user }: { user: UserProfile }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    const unsub = dbService.getSettings(setSettings);
    return () => unsub();
  }, []);

  const tabs: SheetTab[] = [
    { id: "disposition", name: "Диспозиция", sheetUrl: settings?.dispositionSheetUrl || "" },
  ];

  const gpsUrls: Record<GpsTab, string> = {
    beltranssputnik: settings?.gpsBeltranssputnikUrl || "https://beltranssputnik.by",
    wialon: settings?.gpsWialonUrl || "https://hosting.wialon.com/",
    era_glonass: settings?.gpsEraGlonassUrl || "https://aoglonass.ru/",
  };

  return (
    <SheetModuleBase
      user={user}
      moduleKey="disposition"
      title="Диспозиция"
      subtitle="Полная таблица с информацией о местонахождении авто, статусах и комментариях"
      icon={Map}
      iconWrapClass="bg-orange-500/10 border-orange-500/20"
      iconColorClass="text-orange-600"
      tabs={tabs}
      gpsUrls={gpsUrls}
      showTabs={false}
    />
  );
}
