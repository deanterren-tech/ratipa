import { useState, useEffect } from "react";
import { dbService } from "../../api";
import { AppSettings, UserProfile } from "../../types";
import { Table2 } from "lucide-react";
import SheetModuleBase, { SheetTab } from "./SheetModuleBase";
import { resolvePermission } from "../../utils/permissions";

type GpsTab = "beltranssputnik" | "wialon" | "era_glonass";

export default function CurrentPlanningModule({ user }: { user: UserProfile }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    const unsub = dbService.getSettings(setSettings);
    return () => unsub();
  }, []);

  const allowedTabs: SheetTab[] = (settings?.currentPlanningTabs || [])
    .filter((t) => resolvePermission(user, `currentPlanning_${t.id}`, settings?.rolePermissions) !== "none")
    .map((t) => ({ id: t.id, name: t.name, sheetUrl: t.sheetUrl }));

  const gpsUrls: Record<GpsTab, string> = {
    beltranssputnik: settings?.gpsBeltranssputnikUrl || "https://beltranssputnik.by",
    wialon: settings?.gpsWialonUrl || "https://hosting.wialon.com/",
    era_glonass: settings?.gpsEraGlonassUrl || "https://aoglonass.ru/",
  };

  return (
    <SheetModuleBase
      user={user}
      moduleKey="currentPlanning"
      title="Текущее планирование"
      subtitle="Расписание, мониторинг и управление текущими рейсами"
      icon={Table2}
      iconWrapClass="bg-emerald-500/10 border-emerald-500/20"
      iconColorClass="text-emerald-600"
      tabs={allowedTabs}
      gpsUrls={gpsUrls}
      gpsEnabled={false}
    />
  );
}
