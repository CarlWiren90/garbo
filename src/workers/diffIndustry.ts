import { DiscordJob, DiscordWorker } from '../lib/DiscordWorker'
import { defaultMetadata, diffChanges } from '../lib/saveUtils'
import saveToAPI from './saveToAPI'

export class DiffIndustryJob extends DiscordJob {
  declare data: DiscordJob['data'] & {
    existingCompany: any
    companyName: string
    wikidata: { node: string }
    industry: any
  }
}

const diffIndustry = new DiscordWorker<DiffIndustryJob>(
  'diffIndustry',
  async (job) => {
    const { url, companyName, existingCompany, industry } = job.data
    const metadata = defaultMetadata(url)

    const body = {
      industry,
      metadata,
    }

    const { diff, requiresApproval } = await diffChanges({
      existingCompany,
      before: existingCompany?.industry,
      after: industry,
    })

    job.log('Diff:' + diff)

    await saveToAPI.queue.add(companyName + ' industry', {
      ...job.data,
      body,
      diff,
      requiresApproval,
      apiSubEndpoint: 'industry',

      // Remove duplicated job data that should be part of the body from now on
      industry: undefined,
    })

    return { body, diff, requiresApproval }
  }
)

export default diffIndustry
