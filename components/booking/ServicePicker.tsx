export interface Service {
  id: string
  name: string
}

interface ServicePickerProps {
  services: Service[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Shared between the patient booking wizard and reception's walk-in flow — same single-select list, same styling. */
export function ServicePicker({ services, selectedId, onSelect }: ServicePickerProps) {
  return (
    <div className="flex flex-col gap-2">
      {services.map((service) => (
        <button
          key={service.id}
          type="button"
          onClick={() => onSelect(service.id)}
          aria-pressed={selectedId === service.id}
          className={`min-h-11 rounded-lg border px-4 py-3 text-left text-sm font-semibold transition-colors ${
            selectedId === service.id
              ? 'border-primary-700 bg-primary-50 text-primary-700'
              : 'border-border bg-surface text-ink hover:bg-subtle'
          }`}
        >
          {service.name}
        </button>
      ))}
    </div>
  )
}
