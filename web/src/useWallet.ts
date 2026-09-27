import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import type { Provider } from './gateway';
import { message } from './domain';
declare global { interface Window { ethereum?: Provider } }
type Choice = { id: string; name: string; provider: Provider };
export function useWallet() {
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selected, setSelected] = useState('');
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const connected = useRef(false);
  const provider = choices.find(c => c.id === selected)?.provider;
  useEffect(() => {
    const add = (choice: Choice) => {
      setChoices(old => old.some(c => c.provider === choice.provider) ? old : [...old, choice]);
      setSelected(old => old || choice.id);
    };
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<{ info: { uuid: string; name: string }; provider: Provider }>).detail;
      if (detail?.provider && detail.info) add({ id: detail.info.uuid, name: detail.info.name, provider: detail.provider });
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (window.ethereum) add({ id: 'injected', name: 'Browser wallet', provider: window.ethereum });
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);
  useEffect(() => {
    if (!provider) return;
    const accounts = (values: string[]) => { if (connected.current) setAccount(values[0] as Address | undefined); };
    const chain = (value: string) => { if (connected.current) setChainId(Number(value)); };
    const disconnect = () => { connected.current = false; setAccount(undefined); setChainId(undefined); };
    provider.on?.('accountsChanged', accounts);
    provider.on?.('chainChanged', chain);
    provider.on?.('disconnect', disconnect);
    return () => {
      provider.removeListener?.('accountsChanged', accounts);
      provider.removeListener?.('chainChanged', chain);
      provider.removeListener?.('disconnect', disconnect);
    };
  }, [provider]);
  async function sync() {
    if (!provider) return;
    const [accounts, chain] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
    setAccount(accounts[0]); setChainId(Number(chain));
  }
  async function connect() {
    setError('');
    if (!provider) { setError('No browser wallet found. Install an Ethereum wallet or open this page in your wallet’s browser, then reload.'); return; }
    setConnecting(true);
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const chain = await provider.request({ method: 'eth_chainId' });
      if (!accounts[0]) throw Error('No account was shared. Unlock your wallet and try connecting again.');
      connected.current = true; setAccount(accounts[0]); setChainId(Number(chain));
    } catch (err) { setError(message(err)); }
    finally { setConnecting(false); }
  }
  function disconnect() { connected.current = false; setAccount(undefined); setChainId(undefined); setError(''); }
  function select(id: string) { disconnect(); setSelected(id); }
  return { choices, selected, select, provider, account, chainId, error, setError, connecting, connect, disconnect, sync };
}
