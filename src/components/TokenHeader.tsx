import './TokenHeader.css';
import type { Token } from '../types';
import { API_URL } from '../config';

interface TokenHeaderProps {
  token: Token & {
    name: string;
    initiative: number;
    currentHP: number;
    maxHP: number;
    armorClass: number;
    imageUrl?: string;
    portraitUrl?: string;
  };
  isCurrentTurn?: boolean;
  onInitiativeClick?: () => void;
  onHPClick?: () => void;
  onEdit?: () => void;
}

export default function TokenHeader({ token, isCurrentTurn, onInitiativeClick, onHPClick, onEdit }: TokenHeaderProps) {
  const getImageUrl = (url?: string) => {
    if (!url) return '';
    return url.startsWith('http') ? url : `${API_URL}${url}`;
  };

  return (
    <div className="token-header">
      <div className="token-header-image">
        <img src={getImageUrl(token.portraitUrl || token.imageUrl)} alt={token.name} />
      </div>
      
      <div className="token-header-content">
        <h1 className="token-header-name">{token.name}</h1>
        
        <div className="token-header-stats">
          <div className="token-header-stat" onClick={onInitiativeClick} style={{ cursor: onInitiativeClick ? 'pointer' : 'default' }}>
            <label>Initiative</label>
            <div className="token-header-stat-value">{token.initiative}</div>
          </div>
          
          <div className="token-header-stat" onClick={onHPClick} style={{ cursor: onHPClick ? 'pointer' : 'default' }}>
            <label>HP</label>
            <div className="token-header-stat-value">{token.currentHP}/{token.maxHP}</div>
          </div>
          
          <div className="token-header-stat">
            <label>AC</label>
            <div className="token-header-stat-value">{token.armorClass}</div>
          </div>
        </div>
      </div>
      
      {onEdit && (
        <button className="token-header-edit-button" onClick={onEdit}>
          ✏️ Edit
        </button>
      )}
      
      {isCurrentTurn && (
        <div className="token-header-turn-indicator">Your Turn!</div>
      )}
    </div>
  );
}
