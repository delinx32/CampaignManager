import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode, FC } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ShareKeyInfo {
  shareKey: string;
  ownerId: string;
  isOwner: boolean;
}

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  role: string;
  accessibleShareKeys?: ShareKeyInfo[];
  currentShareKey?: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setCurrentShareKey: (shareKey: string) => Promise<void>;
  createShareKey: (shareKey: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const response = await fetch(`${API_URL}/auth/status`, {
        credentials: 'include'
      });
      const data = await response.json();
      
      if (data.authenticated) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = () => {
    // Redirect to Google OAuth
    window.location.href = `${API_URL}/auth/google`;
  };

  const logout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      setUser(null);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const setCurrentShareKey = async (shareKey: string) => {
    try {
      const response = await fetch(`${API_URL}/api/share-keys/current`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ shareKey })
      });
      
      if (response.ok) {
        await checkAuth(); // Refresh user data
      }
    } catch (error) {
      console.error('Failed to set current share key:', error);
    }
  };

  const createShareKey = async (shareKey: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${API_URL}/api/share-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ shareKey })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Update user state directly with the response data
        setUser(prevUser => {
          if (!prevUser) return prevUser;
          return {
            ...prevUser,
            accessibleShareKeys: data.accessibleShareKeys,
            currentShareKey: data.currentShareKey
          };
        });
        return { success: true };
      } else {
        return { success: false, error: data.error || 'Failed to create share key' };
      }
    } catch (error) {
      console.error('Failed to create share key:', error);
      return { success: false, error: 'Network error' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        login,
        logout,
        checkAuth,
        setCurrentShareKey,
        createShareKey
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
