const { ReadableStream } = require('node:stream/web')
const { TextDecoder, TextEncoder } = require('node:util')
const { MessageChannel, MessagePort } = require('node:worker_threads')

Object.assign(globalThis, {
  TextDecoder,
  TextEncoder,
  ReadableStream,
  MessageChannel,
  MessagePort,
})

const { Headers, Request, Response } = require('undici')

Object.assign(globalThis, {
  Headers,
  Request,
  Response,
})
