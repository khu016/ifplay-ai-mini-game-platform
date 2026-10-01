import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { DragZone } from '@/core/viewModel';

function DraggableItem({ id, name, count, disabled }: { id: string; name: string; count: number; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid={`drag-item-${id}`}
      className={`drag-item${isDragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
      disabled={disabled}
    >
      <span className="drag-item-name">{name}</span>
      <span className="drag-item-count">×{count}</span>
    </button>
  );
}

function DropSlot({ id, name, contains, onClear }: { id: string; name: string; contains?: string; onClear: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} data-testid={`drop-slot-${id}`} className={`drop-slot${isOver ? ' over' : ''}`}>
      <span className="drop-slot-name">{name}</span>
      {contains ? (
        <div className="drop-slot-content">
          <span>{contains}</span>
          <button className="btn tiny" onClick={onClear}>
            取回
          </button>
        </div>
      ) : (
        <span className="drop-slot-empty">空</span>
      )}
    </div>
  );
}

export function DragMergeBoard({
  zone,
  onAction,
}: {
  zone: DragZone;
  onAction: (id: string, params?: Record<string, string>) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onAction('drag', { itemId: String(active.id), slotId: String(over.id) });
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="drag-area">
        <div className="drag-slots">
          {zone.slots.map((s) => (
            <DropSlot key={s.id} id={s.id} name={s.name} contains={s.contains} onClear={() => onAction('clear', { slotId: s.id })} />
          ))}
        </div>
        <div className="drag-items">
          {zone.items.map((i) => (
            <DraggableItem key={i.id} id={i.id} name={i.name} count={i.count} disabled={!!i.disabled} />
          ))}
        </div>
        {zone.hint && <p className="drag-hint">{zone.hint}</p>}
      </div>
    </DndContext>
  );
}
