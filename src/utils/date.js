const IST_OFFSET_MINUTES = 5 * 60 + 30;

function parseISTDate(dateValue) {
  if (
    typeof dateValue !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)
  ) {
    const error = new Error("Date must use YYYY-MM-DD format");
    error.statusCode = 400;
    throw error;
  }

  const [year, month, day] = dateValue.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    const error = new Error("Date is invalid");
    error.statusCode = 400;
    throw error;
  }

  return parsedDate;
}

function convertISTDateToUTC(dateValue) {
  const date = parseISTDate(dateValue);
  return new Date(date.getTime() - IST_OFFSET_MINUTES * 60 * 1000);
}

function getISTDayRange(dateValue) {
  const start = convertISTDateToUTC(dateValue);
  const followingDay = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end: followingDay };
}

function getISTDateRange(fromDate, toDate) {
  const range = {};
  if (fromDate) range.$gte = convertISTDateToUTC(fromDate);
  if (toDate) range.$lt = getISTDayRange(toDate).end;

  if (
    range.$gte &&
    range.$lt &&
    range.$gte.getTime() >= range.$lt.getTime()
  ) {
    const error = new Error("The from date must be on or before the to date");
    error.statusCode = 400;
    throw error;
  }

  return Object.keys(range).length ? range : null;
}

module.exports = {
  getISTDayRange,
  convertISTDateToUTC,
  getISTDateRange,
};
