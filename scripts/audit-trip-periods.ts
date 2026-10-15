/** Аудит периодов рейсов одной машины: показывает существующие конфликты списком. */
import { collectCarConflicts } from '../src/components/modules/tripTimeline/lib/tripGuard';
const DB = 'https://ratipa-portal-default-rtdb.firebaseio.com';
const get = async (p: string) => (await (await fetch(`${DB}/${p}.json`)).json()) || {};
(async () => {
  const [tl, pl] = await Promise.all([get('tripTimeline/trips'), get('trips_dashboard')]);
  const rows = [
    ...Object.entries(tl as Record<string, any>).map(([k, v]) => ({ ...v, id: k, _src: 'tripTimeline' })),
    ...Object.entries(pl as Record<string, any>).map(([k, v]) => ({ ...v, id: k, _src: 'trips_dashboard' })),
  ];
  const conflicts = collectCarConflicts(rows as any);
  console.log(`всего записей: ${rows.length}`);
  console.log(`конфликтов: ${conflicts.length}`);
  conflicts.slice(0, 25).forEach((c) => console.log(' •', c.message));
})();
