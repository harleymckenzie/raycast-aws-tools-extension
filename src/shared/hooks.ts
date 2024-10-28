// ./shared/hooks.ts

import { useState, useEffect, useRef } from 'react';
import { fetchBaselineBandwidth, fetchInstanceData, ServiceCode } from './awsClient';
import { getCachedData, setCachedData } from './utils';
import { Toast, showToast } from '@raycast/api';

interface UseAWSInstanceDataOptions<T> {
  region: string;
  serviceCode: ServiceCode;
  cacheKey: string;
  filters: any[];
  dataProcessor?: (data: any) => Record<string, T>;
  dependencies?: any[];
}

export function useAWSInstanceData<T>({
  region,
  serviceCode,
  cacheKey,
  filters,
  dataProcessor,
  dependencies = [],
}: UseAWSInstanceDataOptions<T>) {
  console.log(`Fetching ${serviceCode} instance data for region: ${region}`);
  console.log('Filters:', JSON.stringify(filters, null, 2));
  const [instanceData, setInstanceData] = useState<Record<string, T>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 });
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setLoadingStatus('Checking cache...');
      abortControllerRef.current = new AbortController();

      try {
        const cacheKeyWithRegion = `${cacheKey}_${region}`;
        const cachedData = await getCachedData<Record<string, T>>(cacheKeyWithRegion, 1);
        if (cachedData) {
          setLoadingStatus('Loading cached data...');
          setInstanceData(cachedData);
        } else {
          setLoadingStatus('Fetching data from AWS...');
          const rawData = await fetchInstanceData(
            region,
            serviceCode,
            filters,
            (progress) =>
              setFetchProgress({
                current: progress.current ?? 0,
                total: progress.total ?? 0,
              }),
            abortControllerRef.current.signal
          );
          const processedData = dataProcessor ? dataProcessor(rawData) : rawData;
          setInstanceData(processedData);
          setLoadingStatus('Populating cache...');
          await setCachedData(cacheKeyWithRegion, 1, processedData);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('Error in useAWSInstanceData:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        setError(errorMessage);
        showToast({
          style: Toast.Style.Failure,
          title: 'Error',
          message: errorMessage,
        });
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    };

    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [region, serviceCode, ...dependencies]);

  return { instanceData, error, isLoading, loadingStatus, fetchProgress };
}

export function useBaselineBandwidth(instanceType: string, region: string, selectedProfile: string) {
  const [baselineBandwidth, setBaselineBandwidth] = useState<string | null>(null);
  const [isFetchingBandwidth, setIsFetchingBandwidth] = useState(true);

  useEffect(() => {
    const fetchBandwidth = async () => {
      setIsFetchingBandwidth(true);
      try {
        console.log(`Fetching bandwidth for ${instanceType} in ${region}`);
        const bandwidth = await fetchBaselineBandwidth(
          instanceType,
          region,
          selectedProfile
        );
        setBaselineBandwidth(bandwidth);
      } catch (error) {
        console.error(`Error fetching bandwidth for ${instanceType}:`, error);
      } finally {
        setIsFetchingBandwidth(false);
      }
    };

    fetchBandwidth();
  }, [instanceType, region, selectedProfile]);

  return { baselineBandwidth, isFetchingBandwidth };
}
