import { Worker, Job } from 'bullmq'
import redis from '../config/redis'
import OpenAI from 'openai'
import previousPrompt from '../prompts/parsePDF'
import prompt from '../prompts/reflect'
import { format } from '../queues'
import discord from '../discord'
import { TextChannel } from 'discord.js'
import { askStream } from '../openai'

const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
})

class JobData extends Job {
  data: {
    url: string
    paragraphs: string[]
    answer: string
    threadId: string
    pdfHash: string
    previousAnswer: string
    previousError: string
  }
}

const worker = new Worker(
  'reflectOnAnswer',
  async (job: JobData) => {
    const { previousAnswer, answer, previousError } = job.data

    const message = await discord.sendMessage(
      job.data,
      `🤖 Reflekterar... ${job.attemptsStarted || ''}`
    )

    const childrenValues = Object.values(await job.getChildrenValues()).map(
      (j) => JSON.parse(j)
    )

    job.log(`Reflecting on: 
${answer}
--- Context:
childrenValues: ${JSON.stringify(childrenValues, null, 2)}
--- Prompt:
${prompt}`)

    const response = await askStream(
      [
        {
          role: 'system',
          content:
            'You are an expert in CSRD reporting. Be accurate and follow the instructions carefully.',
        },
        { role: 'user', content: previousPrompt },
        { role: 'assistant', content: answer },
        {
          role: 'assistant',
          content: (childrenValues && JSON.stringify(childrenValues)) || null,
        },
        { role: 'user', content: prompt },
        { role: 'assistant', content: previousAnswer },
        { role: 'user', content: previousError },
      ].filter((m) => m.content) as any[],
      (response, paragraph) => {
        if (!response.includes('```json'))
          discord.sendMessage(job.data, paragraph)
      }
    )

    const json =
      response
        .match(/```json(.|\n)*```/)[0]
        ?.replace(/```json|```/g, '')
        .trim() || '{}'

    let parsedJson
    try {
      parsedJson = JSON.parse(json) // we want to make sure it's valid JSON- otherwise we'll get an error which will trigger a new retry
    } catch (error) {
      job.updateData({
        ...job.data,
        previousAnswer: response,
        previousError: error.message,
      })
      discord.sendMessage(job.data, `❌ ${error.message}:`)
      throw error
    }
    const companyName = parsedJson.companyName

    const thread = (await discord.client.channels.fetch(
      job.data.threadId
    )) as TextChannel
    thread.setName(companyName)

    message.edit(`✅ ${companyName} klar`)
    format.add(companyName, {
      threadId: job.data.threadId,
      json: JSON.stringify(parsedJson, null, 2),
    })

    return JSON.stringify(parsedJson, null, 2)
  },
  {
    concurrency: 10,
    connection: redis,
  }
)

export default worker
