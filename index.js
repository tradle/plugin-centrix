const co = require('co').wrap
const { TYPE } = require('@tradle/constants')
const { parseStub } = require('@tradle/validate-resource').utils
const buildResource = require('@tradle/build-resource')
const { debug, toISODate, pickDefined, getName } = require('./utils')
const { CENTRIX_API_NAME } = require('./constants')
const PHOTO_ID = 'tradle.PhotoID'
const IDENTITY = 'tradle.Identity'
const VERIFICATION = 'tradle.Verification'
const DOCUMENT_TYPES = {
  license: 'driving_licence',
  passport: 'passport'
}

const OPERATION = {
  driving_licence: 'DriverLicenceVerification',
  passport: 'DIAPassportVerification'
}

module.exports = function ({ centrix }) {
  const callCentrix = co(function* ({ req, photoID, props, type }) {
    const method = type === DOCUMENT_TYPES.passport ? 'verifyPassport' : 'verifyLicense'

    // ask centrix to verify it
    props.success = true

    const centrixOpName = OPERATION[type]
    let result
    try {
      debug(`running ${centrixOpName} with Centrix`)
      result = yield centrix[method](props)
    } catch (err) {
      debug(`Centrix ${centrixOpName} verification failed`, err.stack)
      return
    }

    debug(`Centrix ${centrixOpName} success, EnquiryNumber: ${result.ResponseDetails.EnquiryNumber}`)
    const verification = yield createCentrixVerification.call(this, { req, photoID, result })
    const { user, application } = req
    yield this.importVerification({
      req,
      user,
      application,
      verification
    })

    req.application.verifiedByCentrix = true
  })

  const createCentrixVerification = co(function* ({ req, photoID, result }) {
    const { models } = this
    const aspect = 'validity'
    const method = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: CENTRIX_API_NAME,
        provider: {
          id: 'tradle.Organization_dbde8edbf08a2c6cbf26435a30e3b5080648a672950ea4158d63429a4ba641d4_dbde8edbf08a2c6cbf26435a30e3b5080648a672950ea4158d63429a4ba641d4',
          title: 'Centrix'
        }
      },
      reference: [{
        queryId: result.ResponseDetails.EnquiryNumber
      }],
      aspect,
      rawData: result
    }

    const v = {
      [TYPE]: VERIFICATION,
      document: buildResource.stub({
        models,
        model: models[PHOTO_ID],
        resource: photoID
      }),
      documentOwner: {
        id: IDENTITY + '_' + req.customer
      },
      method
    }

    return yield this.sign(v)
  })

  return {
    didReceive: co(function* (req) {
      // don't `return` to avoid slowing down message processing
      const { application } = req
      if (!application) return

      if (hasCentrixVerification({ application })) return

      const centrixData = yield getCentrixData.call(this, { application })
      if (!centrixData) return

      centrixData.req = req
      try {
        yield callCentrix.call(this, centrixData)
      } catch (err) {
        debug('Centrix operation failed', err)
      }
    })
  }
}

const getCentrixData = co(function* ({ application }) {
  if (!application) return

  // get latest
  const stub = application.forms
    .slice()
    .reverse()
    .find(form => parseStub(form).type === PHOTO_ID)

  if (!stub) return

  const parsedStub = parseStub(stub)
  const form = yield this.bot.db.get({
    [TYPE]: parsedStub.type,
    _permalink: parsedStub.permalink
  })

  const { scanJson } = form
  if (!scanJson) return

  const { personal={}, document } = scanJson
  if (!document) return

  const type = getDocumentType(form)
  let { firstName, lastName, birthData, dateOfBirth, sex } = personal
  let { dateOfExpiry, documentNumber } = document
  if (dateOfExpiry) {
    dateOfExpiry = toISODate(dateOfExpiry)
  }

  // let address
  if (type === DOCUMENT_TYPES.license) {
    dateOfBirth = birthData.split(' ')[0]
    dateOfBirth = toISODate(dateOfBirth)
  }

  if (!(firstName && lastName)) {
    try {
      const name = yield getNameFromApplication({
        db: this.bot.db,
        application
      })

      if (name) {
        debug(`got user's name from another form`)
        ({ firstName, lastName } = name)
      }
    } catch (err) {
      debug(`failed to get user's name`)
    }
  }

  const haveAll = documentNumber &&
    firstName &&
    lastName &&
    dateOfBirth &&
    (type === DOCUMENT_TYPES.license || dateOfExpiry)

  if (!haveAll) return

  return {
    type,
    photoID: form,
    props: pickDefined({
      documentNumber,
      dateOfExpiry,
      dateOfBirth,
      firstName,
      lastName,
      sex
    })
  }
})

function getDocumentType (doc) {
  return doc.documentType.title === 'Passport'
    ? DOCUMENT_TYPES.passport
    : DOCUMENT_TYPES.license
}

function hasCentrixVerification ({ application }) {
  return application.verifiedByCentrix
}

// Driver Licence
//
// "personal": {
//   "firstName": "SARAH MEREDYTH",
//   "birthData": "03/11/1976 UNITED KINGOOM",
//   "lastName": "MORGAN"
// },
// "address": {
//   "full": "122 BURNS CRESCENT EDINBURGH EH1 9GP"
// },
// "document": {
//   "dateOfIssue": "01/19/2013",
//   "country": "GBR",
//   "documentNumber": "MORGA753116SM9IJ 35",
//   "personalNumber": null,
//   "issuer": "DVLA",
//   "dateOfExpiry": "01/18/2023"
// }

// Passport
//
// "document": {
//   "dateOfExpiry": "2020-05-27",
//   "dateOfIssue": "2010-05-28",
//   "documentCode": "P<",
//   "documentNumber": "097095832",
//   "issuer": "CHE",
//   "mrzText": "P<USAMEIER<<DAVID<<<<<<<<<<<<<<<<<<<<<<<<<\n2848192940204817878592819829<<<<<<<<<<<<<<00\n",
//   "opt1": "<<<<<<<<<<<<<<",
//   "opt2": ""
// },
// "personal": {
//   "dateOfBirth": "1960-03-11",
//   "firstName": "DAVID",
//   "lastName": "MEIER",
//   "nationality": "SWITZERLAND",
//   "sex": "M"
// }
