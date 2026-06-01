/** President approval required for amounts strictly above this value (in request currency). */
const PRESIDENT_THRESHOLD = 500;

const getPresidentThreshold = (currency = 'PHP') => {
  void currency;
  return PRESIDENT_THRESHOLD;
};

module.exports = {
  PRESIDENT_THRESHOLD,
  getPresidentThreshold,
};
