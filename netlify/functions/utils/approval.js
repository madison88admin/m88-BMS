/** Budget proposals at this amount or above require President final approval (expense/CA logic is separate). */
const PRESIDENT_THRESHOLD = 500;
const BUDGET_PRESIDENT_THRESHOLD = PRESIDENT_THRESHOLD;

const getPresidentThreshold = (currency = 'PHP') => {
  void currency;
  return PRESIDENT_THRESHOLD;
};

const getBudgetPresidentThreshold = (currency = 'PHP') => getPresidentThreshold(currency);

module.exports = {
  PRESIDENT_THRESHOLD,
  BUDGET_PRESIDENT_THRESHOLD,
  getPresidentThreshold,
  getBudgetPresidentThreshold,
};
