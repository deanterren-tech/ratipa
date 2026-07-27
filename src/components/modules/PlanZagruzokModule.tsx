import { useState, useEffect } from "react";
import { dbService } from "../../api";
import { AppSettings, UserProfile } from "../../types";
import { FileSpreadsheet } from "lucide-react";
import SheetModuleBase, { SheetTab } from "./SheetModuleBase";
import { resolvePermission } from "../../utils/permissions";

type GpsTab = "beltranssputnik" | "wialon" | "era_glonass";

export default function PlanZagruzokModule({ user }: { user: UserProfile }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    const unsub = dbService.getSettings(setSettings);
    return () => unsub();
  }, []);

  const hasBase = resolvePermission(user, "planZagruzok", settings?.rolePermissions) !== "none";

  const allowedTabs: SheetTab[] = (() => {
    const tabs: SheetTab[] = [];
    if (hasBase && settings?.planZagruzokSheetUrl) {
      tabs.push({ id: "plan", name: "План загрузок", sheetUrl: settings.planZagruzokSheetUrl });
    }
    if (settings?.planZagruzokBlacklistUrl && resolvePermission(user, "planZagruzok_blacklist", settings?.rolePermissions) !== "none") {
      tabs.push({ id: "blacklist", name: "Чёрный список", sheetUrl: settings.planZagruzokBlacklistUrl });
    }
    const dyn = settings?.planZagruzokTabs || [];
    dyn.forEach((t) => {
      if (resolvePermission(user, `planZagruzok_${t.id}`, settings?.rolePermissions) !== "none") {
        tabs.push({ id: t.id, name: t.name, sheetUrl: t.sheetUrl });
      }
    });
    return tabs;
  })();

  const gpsUrls: Record<GpsTab, string> = {
    beltranssputnik: settings?.gpsBeltranssputnikUrl || "https://beltranssputnik.by",
    wialon: settings?.gpsWialonUrl || "https://hosting.wialon.com/",
    era_glonass: settings?.gpsEraGlonassUrl || "https://aoglonass.ru/",
  };

  return (
    <SheetModuleBase
      user={user}
      moduleKey="planZagruzok"
      title="План загрузок"
      subtitle="Планирование загрузок, чёрные списки и мониторинг"
      icon={FileSpreadsheet}
      iconWrapClass="bg-violet-500/10 border-violet-500/20"
      iconColorClass="text-violet-600"
      tabs={allowedTabs}
      gpsUrls={gpsUrls}
      gpsEnabled={false}
    />
  );
}
