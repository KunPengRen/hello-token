import { ethers } from "ethers";
import { ERC20Mock__factory } from "./ethers-contracts";
import {
  loadDeployedAddresses,
  getWallet,
  wait,
  loadConfig,
  storeDeployedAddresses,
  getChain,
} from "./utils";
import {
  ChainId,
  attestFromEth,
  createWrappedOnEth,
  getSignedVAAWithRetry,
  parseSequenceFromLogEth,
  tryNativeToHexString,
} from "@certusone/wormhole-sdk";
import * as grpcWebNodeHttpTransport from "@improbable-eng/grpc-web-node-http-transport";
import { ChainInfo, getArg } from "./utils";
import axios from 'axios';

const sourceChain = loadConfig().sourceChain;
const targetChain = loadConfig().targetChain;

export async function deployMockToken() {
  const deployed = loadDeployedAddresses();
  const from = getChain(sourceChain);

  const signer = getWallet(from.chainId);
  const HT = await new ERC20Mock__factory(signer).deploy("HelloToken", "HT");
  await HT.deployed();
  console.log(`HT deployed to ${HT.address} on chain ${from.chainId}`);
  deployed.erc20s[sourceChain] = [HT.address];

  console.log("Minting...");
  await HT.mint(signer.address, ethers.utils.parseEther("10")).then(wait);
  console.log("Minted 10 HT to signer");

  console.log(
    `Attesting tokens with token bridge on chain(s) ${loadConfig()
      .chains.map((c) => c.chainId)
      .filter((c) => c === targetChain)
      .join(", ")}`
  );
  for (const chain of loadConfig().chains) {
    if (chain.chainId !== targetChain) {
      continue;
    }
    await attestWorkflow({
      from: getChain(sourceChain),
      to: chain,
      token: HT.address,
    });
  }

  storeDeployedAddresses(deployed);
}

async function attestWorkflow({
  to,
  from,
  token,
}: {
  to: ChainInfo;
  from: ChainInfo;
  token: string;
}) {
  const attestRx: ethers.ContractReceipt = await attestFromEth(
    from.tokenBridge!,
    getWallet(from.chainId),
    token
  );
  const seq = parseSequenceFromLogEth(attestRx, from.wormhole);

  // console.log("vaa url", "https://api.testnet.wormscan.io/api/v1/vaas/"+(Number(from.chainId) as ChainId).toString() + "/"+tryNativeToHexString(from.tokenBridge, "ethereum") +"/"+ seq.toString());
  // const res = await getSignedVAAWithRetry(
  //   ["https://api.testnet.wormscan.io"],
  //   Number(from.chainId) as ChainId,
  //   tryNativeToHexString(from.tokenBridge, "ethereum"),
  //   seq.toString(),
  //   { transport: grpcWebNodeHttpTransport.NodeHttpTransport() }
  // );
  //change to localnet
  const vaa_url = "http://127.0.0.1:7071/v1/signed_vaa/"+(Number(from.chainId) as ChainId).toString() + "/"+tryNativeToHexString(from.tokenBridge, "ethereum") +"/"+ seq.toString();
  console.log("vaa url", vaa_url);
  // getVaaBytes(vaa_url)
  // .then((vaaBytes) => console.log('VAA Bytes:', vaaBytes))
  // .catch((error) => console.error(error));
  const vaaBytes = await getVaaBytes(vaa_url);

  const vaaBytes_u8 = base64ToUint8Array(vaaBytes);
  const createWrappedRx = await createWrappedOnEth(
    to.tokenBridge,
    getWallet(to.chainId),
    vaaBytes_u8
  );
  console.log(
    `Attested token from chain ${from.chainId} to chain ${to.chainId}`
  );
}


function base64ToUint8Array(base64String: string): Uint8Array {
  // Decode the base64 string to a binary string
  const binaryString = atob(base64String);

  // Create a new Uint8Array with the same length as the binary string
  const bytes = new Uint8Array(binaryString.length);

  // Convert each character in the binary string to its char code
  for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
  }

  // Return the Uint8Array
  return bytes;
}



interface ApiResponse {
  vaaBytes: string;
}

async function getVaaBytes(vaa_url: string, retries: number = 5): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios.get<ApiResponse>(vaa_url);
      const vaaBytes = response.data.vaaBytes;
      console.log(vaaBytes);
      return vaaBytes; // Return on successful response
    } catch (error) {
      // console.error(`Attempt ${attempt + 1} failed:`, error);
      lastError = error;
      // Optionally, add a delay here if you want to wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
    }
  }

  console.error('All attempts failed.');
  throw lastError; // Throw the last encountered error after all attempts
}
