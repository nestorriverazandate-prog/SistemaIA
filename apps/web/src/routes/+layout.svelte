<script>
  import PanicButton from '$lib/PanicButton.svelte';
  let { children } = $props();
</script>

{@render children()}
<PanicButton />
