import * as dateFns from 'date-fns';

export const date = {
  filters: {
    /**
     * Return date distance in words to now
     * @param {Date|string|number} date
     * @param {Object} options
     * @return {string}
     */
    distanceInWordsToNow(date, options) {
      if (!date || isNaN((new Date(date)).valueOf())) {
        return 'never';
      }

      return dateFns.distanceInWordsToNow(date, options);
    },
  }
};