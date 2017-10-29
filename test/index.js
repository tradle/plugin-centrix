
const crypto = require('crypto')
const test = require('tape')
const sinon = require('sinon')
const co = require('co').wrap
const { TYPE, SIG } = require('@tradle/constants')
const buildResource = require('@tradle/build-resource')
const fakeResource = require('@tradle/build-resource/fake')
const mergeModels = require('@tradle/merge-models')
const models = mergeModels()
  .add(require('@tradle/models').models)
  .add(require('@tradle/custom-models'))
  .get()

const { toISODate, getNameFromApplication, getNameFromForm } = require('../utils')
const createPlugin = require('../')
const { CENTRIX_API_NAME } = require('../constants')
test('parse date', function (t) {
  t.equal(toISODate('2000-10-11'), '2000-10-11')
  t.equal(toISODate('2000-14-12'), '2000-12-14') // detect inverted month/date
  t.equal(toISODate('14/12/00'), '1900-12-14')
  t.equal(toISODate('14/12/2000'), '2000-12-14')
  t.end()
})

const photoIds = [
  {
    type: 'license',
    form: require('./fixtures/license'),
    success: require('./fixtures/success-license'),
    error: require('./fixtures/error')
  },
  {
    type: 'passport',
    form: require('./fixtures/passport'),
    success: require('./fixtures/success-passport'),
    error: require('./fixtures/error')
  }
]

photoIds.forEach(({ type, form, success, error }) => {
  test(`basic ${form.documentType.title}`, loudCo(function* (t) {
    const forms = [
      form
    ].map(resource => buildResource.stub({
      models,
      resource
    }))

    const application = {
      forms
    }

    const req = {
      application,
      object: form
    }

    const bot = {
      db: {
        get: sinon.stub().callsFake(co(function* (keys) {
          if (keys[TYPE] === form[TYPE]) {
            return form
          }

          throw new Error('NotFound')
        }))
      }
    }

    const centrix = {
      verifyPassport: sinon.stub().resolves(success),
      verifyLicense: sinon.stub().resolves(success)
    }

    const plugin = createPlugin({ centrix })
    const productsAPI = {
      bot,
      models,
      importVerification: sinon.stub().callsFake(co(function* ({ user, application, verification }) {
        t.equal(verification.method.api.name, CENTRIX_API_NAME)
      })),
      sign: sinon.stub().callsFake(co(function* (obj) {
        obj[SIG] = crypto.randomBytes(128).toString('base64')
        return obj
      }))
    }

    yield plugin.didReceive.call(productsAPI, req)

    if (type === 'license') {
      t.same(centrix.verifyLicense.getCall(0).args, [{
        documentNumber: 'MEIER753116SM9IJ 35',
        dateOfExpiry: '2023-2-18',
        dateOfBirth: '1960-3-11',
        firstName: 'DAVID',
        lastName: 'MEIER',
        success: true
      }])
    } else {
      t.same(centrix.verifyPassport.getCall(0).args, [{
        documentNumber: '097095832',
        dateOfExpiry: '2020-5-27',
        dateOfBirth: '1960-03-11',
        firstName: 'DAVID',
        lastName: 'MEIER',
        sex: 'M',
        success: true
      }])
    }

    t.equal(productsAPI.importVerification.callCount, 1)
    t.equal(productsAPI.sign.callCount, 1)
    t.end()
  }))
})

test('getNameFromForm', function (t) {
  const forms = [
    'tradle.Name',
    'tradle.PersonalInfo',
    'tradle.BasicContactInfo',
    'tradle.OnfidoApplicant'
  ].map(type => {
    return fakeResource({
      models,
      model: models[type],
      signed: true
    })
  })

  forms.forEach(form => {
    const name = getNameFromForm({ form })
    t.ok(name.firstName)
    t.ok(name.lastName)
  })

  t.end()
})

test('getNameFromApplication', loudCo(function* (t) {
  const nameForm = fakeResource({
    models,
    model: models['tradle.Name'],
    signed: true
  })

  const forms = [
    buildResource.stub({
      models,
      resource: nameForm
    })
  ]

  const application = {
    forms
  }

  const db = {
    get: keys => {
      t.same(keys, {
        [TYPE]: nameForm[TYPE],
        _permalink: nameForm._permalink
      })

      return Promise.resolve(nameForm)
    }
  }

  const name = yield getNameFromApplication({ db, application })
  t.same(name, {
    firstName: nameForm.givenName,
    lastName: nameForm.surname
  })

  t.end()
}))

function loudCo (gen) {
  return co(function* (...args) {
    try {
      yield co(gen).apply(this, args)
    } catch (err) {
      console.error(err)
      throw err
    }
  })
}
