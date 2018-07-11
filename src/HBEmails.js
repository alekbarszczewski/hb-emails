const Handlebars = require('handlebars')
const sass = require('node-sass')
const juice = require('juice')
const htmlToText = require('html-to-text')
const hbsHelpers = require('handlebars-helpers')
const cheerio = require('cheerio')
const { existsSync, readdirSync, readFileSync } = require('fs')
const { join, extname, basename } = require('path')

class HBEmails {
  static nodemailerPlugin (path, options = {}) {
    const hbe = new HBEmails(path, options)
    return function (mail, done) {
      const data = mail.data || {}
      if (data.html || !data.template) {
        return done()
      }
      try {
        const { subject, text, html } = hbe.renderTemplate(data.template, data, { language: data.language })
        mail.data.subject = subject
        mail.data.text = text
        mail.data.html = html
        done()
      } catch (err) {
        done(err)
      }
    }
  }

  constructor (path, options = {}) {
    this.path = path
    this.helpersPath = join(path, 'helpers.js')
    this.partialPath = join(path, 'partials')
    this.templatePath = join(path, 'templates')
    this.localePath = join(path, 'locale')
    this.globalsPath = join(path, 'globals.js')
    this.defaultLanguage = options.defaultLanguage || 'en'
    this.init()
  }

  init () {
    this.hb = Handlebars.create()
    this.hb.registerPartial('hb', readFileSync(join(__dirname, 'HBPartial.hbs')).toString())
    hbsHelpers({ handlebars: this.hb })
    this.partials = {}
    this.templates = {}
    this.locale = {}
    this.globals = {}
    this.loadHelpers()
    this.loadPartials()
    this.loadTemplates()
    this.loadLocale()
    this.loadGlobals()
  }

  loadHelpers () {
    if (!existsSync(this.helpersPath)) {
      return
    }
    const helpers = require(this.helpersPath)
    Object.keys(helpers).forEach(helperName => {
      this.hb.registerHelper(helperName, helpers[helperName])
    })
  }

  loadPartials () {
    if (!existsSync(this.partialPath)) {
      return
    }
    const partials = readdirSync(this.partialPath)
    partials.forEach(partial => this.loadPartial(partial, join(this.partialPath, partial)))
  }

  loadPartial (partialName, partialPath) {
    const partialTemplate = readFileSync(join(partialPath, `${partialName}.hbs`)).toString()
    this.hb.registerPartial(partialName, partialTemplate)
    this.partials[partialName] = {}
    const stylePath = join(partialPath, `${partialName}.scss`)
    if (existsSync(stylePath)) {
      this.partials[partialName].style = readFileSync(stylePath).toString()
    }
  }

  loadTemplates () {
    if (!existsSync(this.templatePath)) {
      return
    }
    const templates = readdirSync(this.templatePath)
    templates.forEach(template => this.loadTemplate(template, join(this.templatePath, template)))
  }

  loadTemplate (templateName, templatePath) {
    const subTemplates = readdirSync(templatePath)
    .map(fileName => fileName.match(/^welcome-(..)\.hbs$/))
    .filter(matches => matches)
    .map(([fileName, lang]) => ({ fileName, lang }))

    const templateData = {
      localized: {}
    }

    subTemplates.forEach(({ fileName, lang }) => {
      let template = readFileSync(join(templatePath, fileName)).toString()
      template = this.wrapTemplate(template)
      templateData.localized[lang] = this.hb.compile(template)
    })

    const stylePath = join(templatePath, `${templateName}.scss`)
    if (existsSync(stylePath)) {
      templateData.style = readFileSync(stylePath).toString()
    }

    templateData.css = this.compileStyleForTemplate(templateData.style)
    this.templates[templateName] = templateData
  }

  compileStyleForTemplate (templateStyle) {
    const partialStyles = this.getPartialStyles()
    if (templateStyle) {
      partialStyles.push(templateStyle)
    }
    const style = partialStyles.join('\n\n')
    const { css } = sass.renderSync({
      data: style || '/* nothing */'
    })
    return css.toString()
  }

  getPartialStyles () {
    const styles = []
    Object.keys(this.partials).forEach(partialName => {
      if (this.partials[partialName].style) {
        styles.push(this.partials[partialName].style)
      }
    })
    return styles
  }

  loadLocale () {
    if (!existsSync(this.localePath)) {
      return
    }
    const locales = readdirSync(this.localePath).filter(fileName => fileName.match(/\.(js|json)$/))

    locales.forEach(fileName => {
      const localeCode = basename(fileName, extname(fileName))
      this.locale[localeCode] = require(join(this.localePath, fileName))
    })
  }

  loadGlobals () {
    if (!existsSync(this.globalsPath)) {
      return
    }
    this.globals = require(this.globalsPath)
  }

  renderTemplate (templateName, data = {}, options = {}) {
    const lang = options.language || this.defaultLanguage
    data = {
      ...data,
      language: lang,
      [lang]: this.locale[lang]
    }
    const { localized, css } = this.templates[templateName]
    const render = localized[lang]
    let html = render(data, { data: { ...this.globals } })
    html = juice(html, {
      extraCss: css
    })
    const text = htmlToText.fromString(html, {
      preserveNewlines: true
    })

    let subject = cheerio.load(html)('title').text() || ''
    subject = subject.trim()

    return { subject, html, text }
  }

  wrapTemplate (template) {
    return `
      {{#> hb}}
        ${template}
      {{/hb}}
    `
  }
}

module.exports = HBEmails
//
// const hbe = new HBEmails(join(__dirname, '..', 'example'))
//
// const { subject, html, text } = hbe.renderTemplate('welcome', { name: 'John', link: 'http://google.com' }, { language: 'pl' })
//
// console.log('>>>>', subject)
// console.log(html)
