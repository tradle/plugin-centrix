const co = require('co').wrap
const debug = require('debug')(require('./package').name)
const { TYPE } = require('@tradle/constants')
const { parseStub } = require('@tradle/validate-resource').utils
const NAME_FORMS = [
  'tradle.BasicContactInfo',
  'tradle.PersonalInfo',
  'tradle.Name'
]

const getNameFromApplication = co(function* ({ db, application }) {
  for (const stub of application.forms) {
    const { type, permalink } = parseStub(stub)
    if (!NAME_FORMS.includes(type)) continue

    const form = yield db.get({
      [TYPE]: type,
      _permalink: permalink
    })

    return getNameFromForm({ form })
  }
})

module.exports = {
  debug,
  pickDefined,
  getYMD,
  toISODate,
  getNameFromApplication,
  getNameFromForm
}

function pickDefined (obj) {
  const defined = {}
  for (let p in obj) {
    if (obj[p] !== undefined) {
      defined[p] = obj[p]
    }
  }

  return defined
}

function toISODate (strOrMillis) {
  const { year, month, date } = getYMD(strOrMillis)
  return `${year}-${String(month + 1)}-${date}`
}

function getYMD (strOrMillis) {
  if (typeof strOrMillis === 'number') {
    const date = new Date(strOrMillis)
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      date: date.getUTCDate()
    }
  }

  const preformatted = strOrMillis.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  let year, month, date
  if (preformatted) {
    [year, month, date] = preformatted.slice(1)
  } else {
    const match = strOrMillis.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/)
    if (match) {
      [month, date, year] = match.slice(1)
    }
  }

  if (!year) {
    debug('unable to normalize date to ISO', strOrMillis)
    return strOrMillis
  }

  [year, month, date] = [year, month, date].map(str => parseInt(str, 10))

  if (Number(month) > 12) {
    // oof, guesswork
    [date, month] = [month, date]
  }

  // adhere to date.getUTCMonth() value, where Jan is 0
  month--

  if (year < 100) {
    year = '19' + (year < 10 ? '0' : '') + year
    debug(`unable to normalize date to ISO, guessing year ${year} for input ${strOrMillis}`)
  }

  return { year, month, date }
}

function getNameFromForm ({ form }) {
  const type = form[TYPE]
  switch (type) {
    case 'tradle.BasicContactInfo':
    case 'tradle.PersonalInfo':
      const { firstName, lastName } = form
      return { firstName, lastName }
    case 'tradle.Name':
    case 'tradle.OnfidoApplicant':
      const { givenName, surname } = form
      return {
        firstName: givenName,
        lastName: surname
      }
    default:
      return null
  }
}
