import { describe, expect, it } from 'vitest'
import { parseCSVToOperations, parseOpenAPIToOperations, synthesizeOpenAPISpec, type ManualOperation } from './openapiSynth'
import configure from '../locales/en/configure.json'

// A minimal stand-in for react-i18next's t() -- same pattern
// composition/validationCopy.test.ts uses, resolving the real English
// strings from configure.json rather than pulling react-i18next's
// provider/hook machinery into a non-component test.
function t(key: string, vars: Record<string, unknown> = {}): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], configure)
  if (typeof value !== 'string') throw new Error(`missing configure.json key: ${key}`)
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ''))
}

describe('synthesizeOpenAPISpec', () => {
  it('places path/query/header fields as parameters and body fields in requestBody, with secret -> format:password', () => {
    const ops: ManualOperation[] = [{
      path: '/widgets/{id}', method: 'POST', summary: 'Update a widget',
      inputFields: [
        { name: 'id', in: 'path', type: 'string', required: true, secret: false },
        { name: 'verbose', in: 'query', type: 'boolean', required: false, secret: false },
        { name: 'X-Trace-Id', in: 'header', type: 'string', required: false, secret: false },
        { name: 'apiKey', in: 'body', type: 'string', required: true, secret: true },
      ],
      outputFields: [{ name: 'name', in: 'body', type: 'string', required: false, secret: false }],
    }]
    const spec = JSON.parse(synthesizeOpenAPISpec(ops))
    const op = spec.paths['/widgets/{id}'].post

    expect(op.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'verbose', in: 'query' }),
      expect.objectContaining({ name: 'X-Trace-Id', in: 'header' }),
    ]))
    expect(op.parameters).toHaveLength(3) // apiKey (body) must NOT be a parameter
    expect(op.requestBody.content['application/json'].schema.properties.apiKey).toMatchObject({ format: 'password' })
    expect(op.requestBody.content['application/json'].schema.required).toEqual(['apiKey'])
    expect(op.responses['200'].content['application/json'].schema.properties.name).toBeDefined()
  })

  it('writes alias/extractPath as x-mill-alias/x-mill-path extensions', () => {
    const ops: ManualOperation[] = [{
      path: '/widgets', method: 'GET', summary: '',
      inputFields: [],
      outputFields: [{ name: 'n', in: 'body', type: 'string', required: false, secret: false, alias: 'widgetName', extractPath: 'data.name' }],
    }]
    const spec = JSON.parse(synthesizeOpenAPISpec(ops))
    const prop = spec.paths['/widgets'].get.responses['200'].content['application/json'].schema.properties.n
    expect(prop['x-mill-alias']).toBe('widgetName')
    expect(prop['x-mill-path']).toBe('data.name')
  })

  it('skips operations with no path or method', () => {
    const ops: ManualOperation[] = [{ path: '', method: 'GET', summary: '', inputFields: [], outputFields: [] }]
    const spec = JSON.parse(synthesizeOpenAPISpec(ops))
    expect(Object.keys(spec.paths)).toHaveLength(0)
  })

  it('translates map/date/datetime into their real OpenAPI shape (no such type keyword exists)', () => {
    const ops: ManualOperation[] = [{
      path: '/widgets', method: 'POST', summary: '',
      inputFields: [
        { name: 'meta', in: 'body', type: 'map', required: false, secret: false },
        { name: 'createdOn', in: 'body', type: 'date', required: false, secret: false },
        { name: 'updatedAt', in: 'body', type: 'datetime', required: false, secret: false },
      ],
      outputFields: [],
    }]
    const spec = JSON.parse(synthesizeOpenAPISpec(ops))
    const props = spec.paths['/widgets'].post.requestBody.content['application/json'].schema.properties
    expect(props.meta).toMatchObject({ type: 'object', additionalProperties: true })
    expect(props.createdOn).toMatchObject({ type: 'string', format: 'date' })
    expect(props.updatedAt).toMatchObject({ type: 'string', format: 'date-time' })
  })

  it('writes default/description/enum as OpenAPI\'s own standard keywords', () => {
    const ops: ManualOperation[] = [{
      path: '/widgets', method: 'POST', summary: '',
      inputFields: [{
        name: 'status', in: 'body', type: 'string', required: false, secret: false,
        default: 'pending', description: 'current status', enumValues: ['pending', 'active'],
      }],
      outputFields: [],
    }]
    const spec = JSON.parse(synthesizeOpenAPISpec(ops))
    const prop = spec.paths['/widgets'].post.requestBody.content['application/json'].schema.properties.status
    expect(prop.default).toBe('pending')
    expect(prop.description).toBe('current status')
    expect(prop.enum).toEqual(['pending', 'active'])
  })

  it('writes responseExtractPath as an x-mill-response-extract-path extension on the operation', () => {
    const ops: ManualOperation[] = [{
      path: '/widgets', method: 'GET', summary: '', inputFields: [], outputFields: [],
      responseExtractPath: 'envelope.payload',
    }]
    const spec = JSON.parse(synthesizeOpenAPISpec(ops))
    expect(spec.paths['/widgets'].get['x-mill-response-extract-path']).toBe('envelope.payload')
  })
})

describe('parseCSVToOperations', () => {
  it('groups rows by (path, method) and by input/output direction', () => {
    const csv = [
      'path,method,direction,name,in,type,required,secret,alias,extractPath',
      '/widgets/{id},GET,input,id,path,string,true,false,,',
      '/widgets/{id},GET,output,name,body,string,false,false,widgetName,data.name',
      '/widgets/{id},GET,output,token,body,string,false,true,,',
    ].join('\n')

    const { operations, errors } = parseCSVToOperations(t, csv)
    expect(errors).toEqual([])
    expect(operations).toHaveLength(1)
    const op = operations[0]
    expect(op.path).toBe('/widgets/{id}')
    expect(op.method).toBe('GET')
    expect(op.inputFields).toEqual([{ name: 'id', in: 'path', type: 'string', required: true, secret: false, alias: undefined, extractPath: undefined }])
    expect(op.outputFields).toHaveLength(2)
    expect(op.outputFields[0]).toMatchObject({ name: 'name', alias: 'widgetName', extractPath: 'data.name' })
    expect(op.outputFields[1]).toMatchObject({ name: 'token', secret: true })
  })

  it('skips rows missing a required column rather than throwing', () => {
    const csv = ['path,method,direction,name', ',GET,input,noPath', '/widgets,,input,noMethod', '/widgets,GET,input,'].join('\n')
    const { operations } = parseCSVToOperations(t, csv)
    expect(operations).toHaveLength(0)
  })
})

describe('parseOpenAPIToOperations (reverse of synthesizeOpenAPISpec)', () => {
  it('round-trips what synthesizeOpenAPISpec itself produces', () => {
    const original: ManualOperation[] = [{
      path: '/widgets/{id}', method: 'POST', summary: 'Update',
      inputFields: [
        { name: 'id', in: 'path', type: 'string', required: true, secret: false },
        { name: 'note', in: 'body', type: 'string', required: false, secret: false, alias: 'noteAlias' },
      ],
      outputFields: [{ name: 'n', in: 'body', type: 'string', required: false, secret: false, extractPath: 'data.name' }],
    }]
    const spec = synthesizeOpenAPISpec(original)
    const { operations, errors } = parseOpenAPIToOperations(t, spec)

    expect(errors).toEqual([])
    expect(operations).toHaveLength(1)
    const op = operations[0]
    expect(op.path).toBe('/widgets/{id}')
    expect(op.method).toBe('POST')
    expect(op.inputFields.find((f) => f.name === 'id')).toMatchObject({ in: 'path', required: true })
    expect(op.inputFields.find((f) => f.name === 'note')).toMatchObject({ alias: 'noteAlias' })
    expect(op.outputFields[0]).toMatchObject({ name: 'n', extractPath: 'data.name' })
  })

  it('returns a clear error for invalid JSON instead of throwing', () => {
    const { operations, errors } = parseOpenAPIToOperations(t, 'not json')
    expect(operations).toEqual([])
    expect(errors.length).toBeGreaterThan(0)
  })

  it('round-trips map/date/datetime types, default/description/enum, and responseExtractPath', () => {
    const original: ManualOperation[] = [{
      path: '/widgets', method: 'POST', summary: '',
      inputFields: [
        { name: 'meta', in: 'body', type: 'map', required: false, secret: false },
        { name: 'createdOn', in: 'body', type: 'date', required: false, secret: false },
        { name: 'updatedAt', in: 'body', type: 'datetime', required: false, secret: false },
        {
          name: 'status', in: 'body', type: 'string', required: false, secret: false,
          default: 'pending', description: 'current status', enumValues: ['pending', 'active'],
        },
      ],
      outputFields: [],
      responseExtractPath: 'envelope.payload',
    }]
    const spec = synthesizeOpenAPISpec(original)
    const { operations, errors } = parseOpenAPIToOperations(t, spec)

    expect(errors).toEqual([])
    expect(operations).toHaveLength(1)
    const op = operations[0]
    expect(op.responseExtractPath).toBe('envelope.payload')
    expect(op.inputFields.find((f) => f.name === 'meta')).toMatchObject({ type: 'map' })
    expect(op.inputFields.find((f) => f.name === 'createdOn')).toMatchObject({ type: 'date' })
    expect(op.inputFields.find((f) => f.name === 'updatedAt')).toMatchObject({ type: 'datetime' })
    expect(op.inputFields.find((f) => f.name === 'status')).toMatchObject({
      default: 'pending', description: 'current status', enumValues: ['pending', 'active'],
    })
  })
})
