<script>
  import PanicButton from '$lib/PanicButton.svelte';
  import Sidebar from '$lib/Sidebar.svelte';
  let { children } = $props();
</script>

<Sidebar />
{@render children()}
<PanicButton />

<style>
  :global(body.con-menu) { padding-left: 250px; transition: padding .25s ease; }
  :global(body.con-menu .panic-fab) { left: 266px; }
  @media (max-width: 900px) {
    :global(body.con-menu) { padding-left: 0; }
    :global(body.con-menu .panic-fab) { left: 16px; }
  }
</style>
