import type { Token } from '../types';
import { API_URL } from '../config';
import './TokenCard.css';

interface TokenCardProps {
  token: Token;
  currentActorId?: string | null;
  draggedActorId?: string | null;
  isGMView?: boolean;
  editingField?: { tokenId: string; field: 'initiative' | 'hp' } | null;
  editValue?: string;
  onActiveChange?: (tokenId: string, active: boolean) => void;
  onInitiativeEdit?: (tokenId: string, value: number) => void;
  onHPEdit?: (tokenId: string, value: number) => void;
  onStartEditing?: (tokenId: string, field: 'initiative' | 'hp', currentValue: number) => void;
  onEditValueChange?: (value: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onOpenSheet?: (url: string) => void;
  onMarkTurnComplete?: (tokenId: string) => void;
  onEdit?: (token: Token) => void;
  onDelete?: (tokenId: string) => void;
  onDragStart?: (e: React.DragEvent, tokenId: string) => void;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, tokenId: string) => void;
  onDragEnd?: () => void;
  onStateChange?: (tokenId: string, stateName: string | undefined) => void;
}

export default function TokenCard({
  token,
  currentActorId,
  draggedActorId,
  isGMView = false,
  editingField,
  editValue,
  onActiveChange,
  onStartEditing,
  onEditValueChange,
  onSaveEdit,
  onCancelEdit,
  onOpenSheet,
  onMarkTurnComplete,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd,
  onStateChange
}: TokenCardProps) {
  const isCurrentTurn = currentActorId === token.id;
  const isDragging = draggedActorId === token.id;

  return (
    <div 
      className="actor-card"
      draggable={isGMView}
      onDragStart={onDragStart ? (e) => onDragStart(e, token.id) : undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop ? (e) => onDrop(e, token.id) : undefined}
      onDragEnd={onDragEnd}
      style={{
        borderLeft: `4px solid ${token.color || '#0064ff'}`,
        backgroundColor: `${token.color || '#0064ff'}15`,
        cursor: isGMView ? 'move' : 'default',
        opacity: isDragging ? 0.5 : (token.active ? 1 : 0.5),
        filter: token.active ? 'none' : 'grayscale(50%)',
        boxShadow: isCurrentTurn
          ? '0 0 12px 3px rgba(255, 215, 0, 0.8)' 
          : (token.actor?.player ? '0 0 8px 2px rgba(77, 166, 255, 0.6)' : undefined),
        border: isCurrentTurn
          ? '2px solid gold' 
          : (token.actor?.player ? '2px solid #4da6ff' : undefined)
      }}
      title={token.actor?.description || undefined}
    >
      <div 
        className="actor-color-indicator" 
        style={{ backgroundColor: token.color || '#0064ff' }}
      />
      {isGMView && (
        <div className="drag-handle" title="Drag to reorder">⋮⋮</div>
      )}
      <div className="actor-card-content">
        {token.imageUrl && (
          <div className="actor-image-container">
            <img 
              src={token.imageUrl.startsWith('http') ? token.imageUrl : `${API_URL}${token.imageUrl}`} 
              alt={token.actor?.name || 'Token'} 
              className="actor-image" 
              draggable={false} 
            />
          </div>
        )}
        <div className="actor-info">
          {token.actor ? (
            <>
              <div className="actor-header">
                <div className="actor-name-row">
                  {isGMView && onActiveChange && (
                    <label className="active-checkbox">
                      <input
                        type="checkbox"
                        checked={token.active || false}
                        onChange={async (e) => {
                          e.stopPropagation();
                          onActiveChange(token.id, e.target.checked);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        title="Active in combat"
                      />
                    </label>
                  )}
                  <div className="actor-name">{token.actor.name || 'Unnamed'}</div>
                  {currentActorId && (
                    editingField?.tokenId === token.id && editingField?.field === 'initiative' ? (
                      <input
                        type="number"
                        className="initiative-input"
                        value={editValue}
                        onChange={(e) => onEditValueChange?.(e.target.value)}
                        onBlur={onSaveEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onSaveEdit?.();
                          if (e.key === 'Escape') onCancelEdit?.();
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div 
                        className="initiative-badge" 
                        onClick={isGMView && onStartEditing ? (e) => {
                          e.stopPropagation();
                          onStartEditing(token.id, 'initiative', token.actor!.initiative);
                        } : undefined}
                        title={isGMView ? "Click to edit initiative" : undefined}
                        style={{ cursor: isGMView ? 'pointer' : 'default' }}
                      >
                        {token.actor.initiative}
                      </div>
                    )
                  )}
                </div>
                {isGMView && token.states && token.states.length > 0 && onStateChange && (
                  <select
                    value={token.activeState || ''}
                    onChange={(e) => {
                      e.stopPropagation();
                      onStateChange(token.id, e.target.value || undefined);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      padding: '2px 4px',
                      marginTop: '4px',
                      background: '#2a2a2a',
                      color: 'white',
                      border: '1px solid #444',
                      borderRadius: '3px',
                      fontSize: '11px'
                    }}
                  >
                    <option value="">Default</option>
                    {token.states.map(state => (
                      <option key={state.name} value={state.name}>{state.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="actor-stats">
                <span className="stat"><strong>AC:</strong> {token.actor.ac}</span>
                <span className="stat">
                  <strong>HP:</strong> 
                  {editingField?.tokenId === token.id && editingField?.field === 'hp' ? (
                    <input
                      type="number"
                      className="hp-input"
                      value={editValue}
                      onChange={(e) => onEditValueChange?.(e.target.value)}
                      onBlur={onSaveEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onSaveEdit?.();
                        if (e.key === 'Escape') onCancelEdit?.();
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span 
                      className="hp-value"
                      onClick={isGMView && onStartEditing ? (e) => {
                        e.stopPropagation();
                        onStartEditing(token.id, 'hp', token.actor!.hp);
                      } : undefined}
                      title={isGMView ? "Click to edit HP" : undefined}
                      style={{ cursor: isGMView ? 'pointer' : 'default' }}
                    >
                      {token.actor.hp}
                    </span>
                  )}
                </span>
              </div>
            </>
          ) : (
            <div className="actor-name">Unnamed Token</div>
          )}
          {isGMView && (
            <div className="actor-card-buttons">
              {token.actor?.characterSheetUrl && onOpenSheet && (
                <button 
                  className="icon-btn sheet-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSheet(token.actor!.characterSheetUrl!);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Open character sheet"
                >
                  📋
                </button>
              )}
              {token.actor && currentActorId && onMarkTurnComplete && (
                <button 
                  className="icon-btn turn-complete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkTurnComplete(token.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Mark turn complete"
                >
                  ✓
                </button>
              )}
              {onEdit && (
                <button 
                  className="icon-btn edit-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(token);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Edit token"
                >
                  ✏️
                </button>
              )}
              {onDelete && (
                <button 
                  className="icon-btn delete-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(token.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Delete token"
                >
                  🗑️
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
