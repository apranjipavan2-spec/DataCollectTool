import { useState, useEffect } from 'react'
import api from '@/lib/api'

interface Props {
  formId: string
  formTitle: string
  onClose: () => void
}

export default function AiReportModal({ formId, formTitle, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.post(`/ai/report/${formId}`)
      .then(({ data }) => setReport(data.report_md))
      .catch((err) => {
        const status = err.response?.status
        if (status === 400) {
          setError('Configure AI in Org Settings → AI tab first')
        } else {
          setError(err.response?.data?.detail || 'Failed to generate report')
        }
      })
      .finally(() => setLoading(false))
  }, [formId])

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
            <h2 className="text-base font-semibold text-catalan-text">🤖 AI Report</h2>
            <p className="text-xs text-catalan-textMuted">{formTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-catalan-textMuted hover:text-catalan-text transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading && (
            <div className="flex items-center gap-3 text-catalan-textMuted text-sm">
              <svg className="animate-spin h-5 w-5 text-catalan-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Generating report…
            </div>
          )}
          {error && (
            <div className="text-sm text-catalan-error bg-catalan-error/10 rounded-lg p-4">
              {error}
            </div>
          )}
          {report && (
            <pre className="font-mono text-sm text-catalan-text whitespace-pre-wrap overflow-auto max-h-96 leading-relaxed">
              {report}
            </pre>
          )}
        </div>

        {report && (
          <div className="px-6 py-4 border-t border-catalan-border flex justify-end">
            <button
              onClick={handleDownload}
              className="px-4 py-2 text-sm font-medium bg-catalan-primary text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              📥 Download .txt
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
