-- Wire ERC-8004 IdentityRegistry agentId into the local agent row.
-- The IdentityRegistry contract was deployed at 0x96631e6cdc6bb37f10c3a132149ddde7e8061d05
-- on Arc Testnet (block 37717832). The demo agent (wallet 0x39e1...db6a5) was registered
-- as agentId = 1 (block 37717846). Mirror that ID locally so off-chain code can resolve
-- agentId without a contract read on every request.

alter table public.darwinia_agents
  add column if not exists onchain_agent_id int;

create unique index if not exists darwinia_agents_onchain_agent_id_uniq
  on public.darwinia_agents(onchain_agent_id)
  where onchain_agent_id is not null;

update public.darwinia_agents
set onchain_agent_id = 1
where wallet_address = '0x39e16991c1612ad82e0df07545cf792b983db6a5'
  and onchain_agent_id is null;
