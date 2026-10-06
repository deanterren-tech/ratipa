import { UserProfile } from "../../types";
import { AppSettings } from "../../types";
import { Coins } from "lucide-react";
import SheetModuleBase, { SheetTab } from "./SheetModuleBase";

interface DriverExpensesModuleProps {
  user: UserProfile;
  settings?: AppSettings;
}

export default function DriverExpensesModule({ user, settings }: DriverExpensesModuleProps) {
  const sheetUrl = settings?.driverExpensesUrl || "";
  const tabs: SheetTab[] = sheetUrl
    ? [{ id: "main", name: "Расходы водителей", sheetUrl }]
    : [];

  return (
    <SheetModuleBase
      user={user}
      moduleKey="driverExpenses"
      title="Расходы водителей"
      subtitle="Учёт расходов водителей"
      icon={Coins}
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
