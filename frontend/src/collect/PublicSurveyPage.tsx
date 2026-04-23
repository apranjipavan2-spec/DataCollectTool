import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import FormRenderer, { type SubmissionDraft } from '@/renderer/FormRenderer'
import type { FormSchema } from '@/types/form'

export default function PublicSurveyPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    axios.get(`/api/v1/public/survey/${token}/info`)
      .then(r => {
        setSchema(r.data.json_schema as FormSchema)
        setFormTitle(r.data.title)
      })
      .catch(() => setError('This survey link is invalid or has been deactivated.'))
      .finally(() => setLoading(false))
  }, [token])

  const handleSubmit = async (draft: SubmissionDraft) => {
    if (!token) return
    setSubmitting(true)
    try {
      await axios.post(`/api/v1/public/survey/${token}/submit`, { data_json: draft.data })
      setSubmitted(true)
    } catch (err: any) {
      if (err.response?.status === 429) {
        alert('Too many submissions from this device. Please try again later.')
      } else {
        alert('Submission failed. Please check your connection and try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-catalan-bg flex items-center justify-center">
        <div className="text-catalan-textMuted text-sm animate-pulse">Loading survey…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-lg font-semibold text-catalan-text mb-2">Survey Unavailable</h1>
          <p className="text-sm text-catalan-textMuted">{error}</p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center bg-catalan-surface border border-catalan-border rounded-2xl p-8">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-catalan-text mb-2">Thank you!</h1>
          <p className="text-sm text-catalan-textMuted">Your response has been recorded successfully.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-catalan-bg">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-catalan-text">{formTitle}</h1>
          <p className="text-xs text-catalan-textMuted mt-1">Please fill in all required fields and submit.</p>
        </div>
        {schema && (
          <FormRenderer
            schema={schema}
            onSave={async () => {}}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  )
}
