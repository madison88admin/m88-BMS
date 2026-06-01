/** President approval required for amounts strictly above this value (in request currency). */
export const PRESIDENT_THRESHOLD = 500;

export const getPresidentThreshold = (currency = 'PHP') => {
  void currency;
  return PRESIDENT_THRESHOLD;
};
