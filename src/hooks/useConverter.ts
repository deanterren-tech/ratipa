import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { dbService } from '../api'

export function useConverter() {
  const [isConverterOpen, setIsConverterOpen] = useState(false);
  const [isEditingCurrencies, setIsEditingCurrencies] = useState(false);
  const [isRatesLoading, setIsRatesLoading] = useState(false);
  const [activeCurrency, setActiveCurrency] = useState<string>(() => localStorage.getItem('ratipa_converter_currency') || 'USD');
  const [activeValue, setActiveValue] = useState<string>(() => localStorage.getItem('ratipa_converter_value') || '100');
  const [availableCurrencies, setAvailableCurrencies] = useState<any[]>([]);

  const [selectedCurrencyCodes, setSelectedCurrencyCodes] = useState<string[]>(() => {
    const saved = localStorage.getItem('ratipa_selected_currencies');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {}
    }
    return ['USD', 'EUR', 'BYN', 'RUB'];
  });

  const [rates, setRates] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('ratipa_converter_rates');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      USD: 3.25,
      EUR: 3.55,
      RUB: 0.036,
      BYN: 1.0,
      TRY: 0.10,
      KZT: 0.0073,
      CNY: 0.45
    };
  });

  const converterRef = useRef<HTMLDivElement>(null);
  const converterDesktopRef = useRef<HTMLDivElement>(null);
  const converterPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return dbService.getCurrencies((list) => {
      setAvailableCurrencies(list || []);
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('ratipa_selected_currencies', JSON.stringify(selectedCurrencyCodes));
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedCurrencyCodes]);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('ratipa_converter_currency', activeCurrency);
    }, 500);
    return () => clearTimeout(timer);
  }, [activeCurrency]);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('ratipa_converter_value', activeValue);
    }, 500);
    return () => clearTimeout(timer);
  }, [activeValue]);

  useEffect(() => {
    fetchNbrbRates();
  }, []);

  const fetchNbrbRates = useCallback(async () => {
    setIsRatesLoading(true);
    try {
      let response = await fetch('/api/nbrb-rates');
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || !contentType.includes('application/json')) {
        response = await fetch('https://www.nbrb.by/api/exrates/rates?periodicity=0');
      }

      if (!response.ok) throw new Error('Data status check');
      const data = await response.json();

      if (Array.isArray(data)) {
        const foundRates: Record<string, number> = { BYN: 1.0 };
        data.forEach((item: any) => {
          if (item && item.Cur_Abbreviation && item.Cur_OfficialRate && item.Cur_Scale) {
            foundRates[item.Cur_Abbreviation] = item.Cur_OfficialRate / item.Cur_Scale;
          }
        });

        if (foundRates.USD && foundRates.EUR && foundRates.RUB) {
          setRates(prev => {
            const merged = { ...prev, ...foundRates };
            localStorage.setItem('ratipa_converter_rates', JSON.stringify(merged));
            return merged;
          });
        }
      } else {
        throw new Error('Expected data structure');
      }
    } catch (error) {
    } finally {
      setIsRatesLoading(false);
    }
  }, []);

  const getDisplayValue = useCallback((currency: string) => {
    if (activeCurrency === currency) {
      return activeValue;
    }
    if (!activeValue || activeValue === '0' || activeValue === '0.0' || activeValue === '0.00') return '';
    const numericVal = parseFloat(activeValue);
    if (isNaN(numericVal) || numericVal === 0) {
      return '';
    }
    const fromRate = rates[activeCurrency] || 1.0;
    const toRate = rates[currency] || 1.0;
    const valInByn = numericVal * fromRate;
    const targetVal = valInByn / toRate;
    if (currency === 'RUB') {
      return targetVal.toFixed(1);
    }
    return targetVal.toFixed(2);
  }, [activeCurrency, activeValue, rates]);

  const displayValues = useMemo(() => {
    const result: Record<string, string> = {};
    selectedCurrencyCodes.forEach(code => {
      result[code] = getDisplayValue(code);
    });
    return result;
  }, [activeCurrency, activeValue, rates, selectedCurrencyCodes, getDisplayValue]);

  return {
    isConverterOpen,
    setIsConverterOpen,
    isEditingCurrencies,
    setIsEditingCurrencies,
    isRatesLoading,
    activeCurrency,
    setActiveCurrency,
    activeValue,
    setActiveValue,
    selectedCurrencyCodes,
    setSelectedCurrencyCodes,
    rates,
    displayValues,
    converterRef,
    converterDesktopRef,
    converterPanelRef,
    fetchNbrbRates,
    availableCurrencies,
  };
}