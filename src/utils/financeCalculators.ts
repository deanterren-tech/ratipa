import { LegPlan } from "../types";

export function calculateTripFinances(
  legs: LegPlan[],
  dateStart: string,
  dateEnd: string,
  extraExpense: number = 0,
  ferryCost: number = 0,
  factKm: number = 0
) {
  // 1. Days calculation
  let days = 0;
  if (dateStart && dateEnd) {
    const start = new Date(dateStart);
    const end = new Date(dateEnd);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      const diffTime = Math.abs(end.getTime() - start.getTime());
      days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
    }
  }

  // 2. Financial calculation
  // Total Distance
  const totalKm = legs.reduce((acc, l) => acc + Number(l.km || 0) + Number(l.emptyRunKm || l.emptyRun || 0), 0);
  
  // Total Freight (rate in PlanDohod, freight in Dohod, we try both)
  const totalFreight = legs.reduce((acc, l) => acc + Number(l.rate ?? l.freight ?? 0), 0);

  // Total Expenses Plan
  const baseExpenses = legs.reduce((acc, l) => {
    const coeff = Number(l.coeff || 0);
    const legDistance = Number(l.km || 0) + Number(l.emptyRunKm || l.emptyRun || 0);
    const legFerry = Number(l.ferry || l.ferryCost || 0);
    return acc + (legDistance * coeff) + legFerry;
  }, 0);

  const totalExpensesPlan = baseExpenses + Number(extraExpense || 0) + Number(ferryCost || 0);
  
  const profit = totalFreight - totalExpensesPlan;

  // Actual values (Fact)
  let totalExpenses = totalExpensesPlan;
  let profitFact = profit;

  const fKm = Number(factKm || 0);
  if (fKm > 0 && totalKm > 0) {
    const expensePerKm = totalExpensesPlan / totalKm;
    const factExpenses = expensePerKm * fKm;
    totalExpenses = factExpenses;
    profitFact = totalFreight - factExpenses;
  }

  // Dual days calculation
  const daysPlan = days > 0 ? days : (totalKm > 0 ? Math.max(1, Math.round(totalKm / 500)) : 1);
  const daysFact = days > 0 ? days : (fKm > 0 ? Math.max(1, Math.round(fKm / 500)) : daysPlan);

  // Derived values
  const profitPerDay = daysFact > 0 ? profitFact / daysFact : 0;
  const planProfitPerDay = daysPlan > 0 ? profit / daysPlan : 0;

  return {
    days: daysFact,
    daysPlan,
    daysFact,
    totalKm,
    totalFreight,
    totalExpensesPlan,
    totalExpensesFact: totalExpenses,
    profitPlan: profit,
    profitFact,
    profitPerDay,
    planProfitPerDay
  };
}