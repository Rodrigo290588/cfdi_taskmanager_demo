import { prisma } from '@/lib/prisma'
import { massDownloadQueue } from '@/lib/queue'
import { RequestStatus } from '@prisma/client'
import { differenceInDays, addMonths, startOfMonth, endOfMonth } from 'date-fns'

interface CreateRequestParams {
  companyId: string
  requestingRfc: string
  issuerRfc: string
  receiverRfc?: string
  startDate: Date
  endDate: Date
  requestType: string
  retrievalType: string
  folio?: string
  voucherType?: string
  status?: string
  thirdPartyRfc?: string
  complement?: string
}

export class MassDownloadService {
  async createRequest(params: CreateRequestParams) {
    const { startDate, endDate } = params
    
    // Check if splitting is needed (range > 30 days)
    const daysDiff = differenceInDays(endDate, startDate)
    
    if (daysDiff > 30) {
      // Split into monthly chunks
      return this.createSplitRequests(params)
    }

    // Single request
    return this.createSingleRequest(params)
  }

  private async createSingleRequest(params: CreateRequestParams) {
    const request = await prisma.massDownloadRequest.create({
      data: {
        companyId: params.companyId,
        requestingRfc: params.requestingRfc,
        issuerRfc: params.issuerRfc,
        receiverRfc: params.receiverRfc,
        startDate: params.startDate,
        endDate: params.endDate,
        requestType: params.requestType,
        retrievalType: params.retrievalType,
        folio: params.folio,
        status: params.status || 'Todos',
        requestStatus: RequestStatus.SOLICITADO,
        voucherType: params.voucherType,
        thirdPartyRfc: params.thirdPartyRfc,
        complement: params.complement,
      },
    })

    // Add to Queue
    await massDownloadQueue.add('process-request', {
      requestId: request.id,
      rfc: params.requestingRfc, // Grouping key for concurrency
    }, {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 10,
      backoff: {
        type: 'exponential',
        delay: 5000, // Start with 5s delay
      }
    })

    return [request]
  }

  private async createSplitRequests(params: CreateRequestParams) {
    const requests = []
    let currentStart = params.startDate
    const finalEnd = params.endDate

    while (currentStart < finalEnd) {
      // Calculate end of this chunk (end of month or final date)
      // Actually, SAT allows up to 200k records. Monthly is a safe heuristic.
      // We can do: start to end of current month, then next month start to end of next month...
      
      let currentEnd = endOfMonth(currentStart)
      if (currentEnd > finalEnd) {
        currentEnd = finalEnd
      }

      // Create request for this chunk
      const request = await prisma.massDownloadRequest.create({
        data: {
          companyId: params.companyId,
          requestingRfc: params.requestingRfc,
          issuerRfc: params.issuerRfc,
          receiverRfc: params.receiverRfc,
          startDate: currentStart,
          endDate: currentEnd,
          requestType: params.requestType,
          retrievalType: params.retrievalType,
          folio: params.folio,
          status: params.status || 'Todos',
          requestStatus: RequestStatus.SOLICITADO,
          voucherType: params.voucherType,
          thirdPartyRfc: params.thirdPartyRfc,
          complement: params.complement,
        },
      })

      await massDownloadQueue.add('process-request', {
        requestId: request.id,
        rfc: params.requestingRfc,
      }, {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 10,
        backoff: {
          type: 'exponential',
          delay: 5000,
        }
      })

      requests.push(request)

      // Move to next month
      currentStart = addMonths(startOfMonth(currentStart), 1)
      // Adjust if we overshot (though logic above handles it)
      if (currentStart > finalEnd) break
    }

    return requests
  }
}

export const massDownloadService = new MassDownloadService()
