/**
 * Список зарплатных записей, у которых сохранённый итог ≠ сумме сохранённых
 * слагаемых (км×ставка + простой + дни×суточные + премия) — только чтение.
 *
 * Запуск: npx tsx scripts/audit-salary-totals.ts
 */
const DB = 'https://ratipa-portal-default-rtdb.firebaseio.com';
const get = async (p: string) => (await (await fetch(`${DB}/${p}.json`)).json()) || null;

(async () => {
  const months = (await get('salaryHistory/months')) || {};
  const rows: Array<{ month: string; key: string; rec: Record<string, any> }> = [];
  for (const [month, bucket] of Object.entries(months as Record<string, Record<string, any>>)) {
    for (const [key, rec] of Object.entries(bucket || {})) {
      if (rec && typeof rec === 'object') rows.push({ month, key, rec });
    }
  }
  const mismatches = rows.filter(({ rec }) => {
    const nums = ['kmMoney', 'idleMoney', 'daysMoney', 'totalSalary'].map((f) => rec[f]);
    if (nums.some((v) => typeof v !== 'number')) return false;
    const storedSum = rec.kmMoney + rec.idleMoney + rec.daysMoney + (rec.bonus ?? 0);
    return !Object.is(storedSum, rec.totalSalary);
  });
  console.log(`всего зарплатных записей: ${rows.length}; расхождений: ${mismatches.length}`);
  mismatches.forEach(({ month, key, rec }) => {
    const storedSum = rec.kmMoney + rec.idleMoney + rec.daysMoney + (rec.bonus ?? 0);
    console.log(' •', JSON.stringify({
      месяц: month, ключ: key, создано: rec.createdAt || rec.date || null,
      машина: rec.carNumber || null, водитель: rec.driverName || rec.driver || null,
      км: rec.km ?? rec.totalKm ?? null, ставка: rec.rate ?? null,
      км_деньги: rec.kmMoney, простой: rec.idleMoney, дни_деньги: rec.daysMoney, премия: rec.bonus ?? null,
      сумма_слагаемых: storedSum, сохранённый_итог: rec.totalSalary, разница: Number((rec.totalSalary - storedSum).toFixed(2)),
    }, null, 0));
  });
})();
