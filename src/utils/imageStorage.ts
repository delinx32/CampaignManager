// Simple IndexedDB wrapper for storing images
const DB_NAME = 'CampaignManagerDB';
const STORE_NAME = 'maps';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const saveImage = async (imageData: string, filename: string): Promise<string> => {
  const database = await initDB();
  const id = `map_${Date.now()}_${filename}`;
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id, imageData, filename, timestamp: Date.now() });

    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });
};

export const getImage = async (id: string): Promise<string | null> => {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? result.imageData : null);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllImages = async (): Promise<Array<{ id: string; filename: string; timestamp: number }>> => {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result.map((item: any) => ({
        id: item.id,
        filename: item.filename,
        timestamp: item.timestamp
      }));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteImage = async (id: string): Promise<void> => {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
