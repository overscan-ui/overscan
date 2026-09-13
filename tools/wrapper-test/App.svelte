<script>
  import OvChart from '../../src/svelte/OvChart.svelte';
  import OvGauge from '../../src/svelte/OvGauge.svelte';
  import OvSegment from '../../src/svelte/OvSegment.svelte';
  import OvTransport from '../../src/svelte/OvTransport.svelte';
  let values = $state([10, null, 30]);
</script>

<OvChart id="c" mode="line" min="0" max="100" {values} />
<OvGauge id="g" min="0" max="100" value={null} />
<OvSegment id="s" digits="4" value="01.50" />
<OvTransport id="t" duration="10" onplay={() => { window.__PLAY__ = true; }} />
