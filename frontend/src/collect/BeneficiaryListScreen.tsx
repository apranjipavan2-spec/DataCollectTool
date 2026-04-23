import React, { useState, useEffect } from 'react'
import api from '@/lib/api'

export interface RosterEntry {
  id: string
  name: string
  phone: string | null
  address: string | null
  scheduled_date: string | null
  notes: string | null
  extra_data: Record<string, string>
  collected: boolean
  submission_id: string | null
  status: string
  location_id: string | null
  location_name: string | null
}

interface LocationOption {
  id: string
  name: string
  type: string
  parent_id: string | null
}

interface Props {
  formTitle: string
  formId: string
  onSelect: (entry: RosterEntry) => void
  onBack: () => void
  userId: string
}

export default function BeneficiaryListScreen({ formTitle, formId, onSelect, onBack, userId }: Props) {
  const [districts, setDistricts] = useState<LocationOption[]>([])
  const [talukas, setTalukas] = useState<LocationOption[]>([])
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [selectedTaluka, setSelectedTaluka] = useState('')
  const [beneficiaries, setBeneficiaries] = useState<RosterEntry[]>([])
  const [hasLocationData, setHasLocationData] = useState(false)
  const [loadingDistricts, setLoadingDistricts] = useState(true)
  const [loadingBeneficiaries, setLoadingBeneficiaries] = useState(false)

  useEffect(() => {
    const fetchDistricts = async () => {
      try {
        const { data } = await api.get('/locations?type=district')
        setDistricts(data)
        setHasLocationData(data.length > 0)
        if (data.length === 0) {
          loadBeneficiaries()
        }
      } catch {
        setHasLocationData(false)
        loadBeneficiaries()
      } finally {
        setLoadingDistricts(false)
      }
    }
    fetchDistricts()
  }, [])

  const loadBeneficiaries = async (locationId?: string) => {
    setLoadingBeneficiaries(true)
    try {
      const params: Record<string, string> = { form_id: formId }
      if (locationId) params.location_id = locationId
      const { data } = await api.get('/roster/with-status', { params })
      setBeneficiaries(data)
    } catch {
      setBeneficiaries([])
    } finally {
      setLoadingBeneficiaries(false)
    }
  }

  const handleDistrictChange = async (districtId: string) => {
    setSelectedDistrict(districtId)
    setSelectedTaluka('')
    setTalukas([])
    setBeneficiaries([])
    if (!districtId) return
    try {
      const { data } = await api.get(`/locations?parent_id=${districtId}`)
      setTalukas(data)
    } catch {
      setTalukas([])
    }
  }

  const handleTalukaChange = (talukaId: string) => {
    setSelectedTaluka(talukaId)
    if (talukaId) {
      loadBeneficiaries(talukaId)
    } else {
      setBeneficiaries([])
    }
  }

  const pending = beneficiaries.filter(e => !e.collected)
  const collected = beneficiaries.filter(e => e.collected)

  const selectClass = "w-full bg-catalan-bg border border-catalan-border rounded-xl px-4 py-3 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary appearance-none"

  return (
    <div className="flex flex-col h-screen bg-catalan-bg">
      <div className="bg-catalan-surface border-b border-catalan-border sticky top-0 z-10">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-catalan-hover text-catalan-textMuted hover:text-catalan-primary hover:bg-catalan-primary/10 transition-all flex-shrink-0"
          >
            &larr;
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-catalan-text truncate">{formTitle}</h1>
            <p className="text-xs text-catalan-textMuted">
              {pending.length} pending · {collected.length} collected
            </p>
          </div>
        </div>
      </div>

      {!loadingDistricts && hasLocationData && (
        <div className="px-4 sm:px-6 pt-4 pb-2 space-y-3">
          <div className="relative">
            <select
              value={selectedDistrict}
              onChange={e => handleDistrictChange(e.target.value)}
              className={selectClass}
            >
              <option value="">Select District</option>
              {districts.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-catalan-textMuted text-xs">▼</span>
          </div>

          {selectedDistrict && (
            <div className="relative">
              <select
                value={selectedTaluka}
                onChange={e => handleTalukaChange(e.target.value)}
                className={selectClass}
                disabled={talukas.length === 0}
              >
                <option value="">Select Taluka</option>
                {talukas.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-catalan-textMuted text-xs">▼</span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-2">
        {hasLocationData && !selectedDistrict && (
          <div className="text-center py-16 text-catalan-textMuted text-sm">
            📍 Select your area first
          </div>
        )}

        {hasLocationData && selectedDistrict && !selectedTaluka && (
          <div className="text-center py-16 text-catalan-textMuted text-sm">
            Select a taluka to see beneficiaries
          </div>
        )}

        {loadingBeneficiaries && (
          <div className="text-center py-16 text-catalan-textMuted text-sm">Loading…</div>
        )}

        {!loadingBeneficiaries && (!hasLocationData || selectedTaluka) && beneficiaries.length === 0 && (
          <div className="text-center py-16 text-catalan-textMuted text-sm">No beneficiaries assigned</div>
        )}

        {!loadingBeneficiaries && (!hasLocationData || selectedTaluka) && beneficiaries.map(entry => (
          <button
            key={entry.id}
            onClick={() => onSelect(entry)}
            className={`w-full text-left p-4 rounded-xl border transition-all duration-150 ${
              entry.collected
                ? 'bg-catalan-surface border-catalan-border opacity-70'
                : 'bg-catalan-surface border-catalan-border hover:border-catalan-primary hover:bg-catalan-primary/5 active:scale-[0.99]'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {entry.collected ? (
                  <span className="text-catalan-success text-lg">✅</span>
                ) : (
                  <span className="text-catalan-textMuted text-lg">⏳</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-catalan-text text-sm truncate">{entry.name}</div>
                {entry.phone && (
                  <div className="text-xs text-catalan-textMuted font-mono mt-0.5">{entry.phone}</div>
                )}
                {entry.address && (
                  <div className="text-xs text-catalan-textMuted mt-0.5 truncate">{entry.address}</div>
                )}
                {entry.scheduled_date && (
                  <div className="text-xs text-catalan-textMuted mt-0.5">📅 {entry.scheduled_date}</div>
                )}
              </div>
              <div className="flex-shrink-0">
                {entry.collected ? (
                  <span className="text-xs text-catalan-success font-medium">Collected</span>
                ) : (
                  <span className="text-xs text-catalan-primary font-medium">Tap to start →</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
