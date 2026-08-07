import { useEffect } from 'react'
import api from '@/lib/api'
import { useAiJob } from '@/lib/useAiJob'
import AiProgressBar from '@/components/AiProgressBar'
import EmojiIcon from '@/components/EmojiIcon'

interface Props {
  formId: string
  formTitle: string
  onClose: () => void
}

export default function AiReportModal({ formId, formTitle, onClose }: Props) {
  const aiJob = useAiJob({ storageKey: `ai_report_${formId}` })

  useEffect(() => {
    if (!aiJob.job) {
      // startJob sets job.status to 'failed' itself before rejecting, so
      // AiProgressBar already shows the error — this catch just prevents an
      // unhandled-rejection warning, it isn't swallowing anything important.
      aiJob.startJob(() => api.post(`/ai/report/${formId}`)).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const report = aiJob.job?.result ?? null

  const handleDownload = () => {
    if (!report) return
    const blob = new Blob([report], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${formTitle.replace(/\s+/g, '_')}_ai_report.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-catalan-surface rounded-xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-catalan-border">
          <div>
            <h2 className="text-base font-semibold text-catalan-text">AI Report</h2>
            <p className="text-xs text-catalan-textMuted">{formTitle}</p>
          </div>
          <button onClick={onClose} className="text-catalan-textMuted hover:text-catalan-text transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          <AiProgressBar job={aiJob.job} label="Report" onReset={aiJob.reset} />
          {report && (
            <pre className="font-mono text-sm text-catalan-text whitespace-pre-wrap overflow-auto max-h-96 leading-relaxed">
              {report}
            </pre>
          )}
        </div>

        {report && (
          <div className="px-6 py-4 border-t border-catalan-border flex justify-end">
            <button onClick={handleDownload} className="px-4 py-2 text-sm font-medium bg-catalan-primary text-white rounded-lg hover:opacity-90 transition-opacity">
              Download .txt
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
