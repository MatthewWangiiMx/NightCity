import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { District } from '@/api/types';

export function useDistrict(districtId = 'nightcity') {
  const [district, setDistrict] = useState<District>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .district(districtId)
      .then(setDistrict)
      .catch((e: Error) => setError(e.message));
  }, [districtId]);

  return { district, error };
}
