import { pack } from 'msgpackr';
import { VSCode} from './bridge';
import { VSCodePostTypeDefine, type CreatePublisherRequestPayload, type TopicMessage } from './bridge_types';

export class Publisher
{
  constructor (topic: string) 
  {
    this.topic_ = topic;
    const request: CreatePublisherRequestPayload = {
      "topic": topic, 
      "msg_type": "std_msgs/String"
    };
    VSCode.request<boolean>(VSCodePostTypeDefine.CREATE_PUBLISHER, request)
    .then((res: boolean) => {
      this.is_valid_ = res;
    }).catch((error: any) => {
      console.error(error);
    });
  }
  
  publish(msg: any) 
  {
    if (this.is_valid_ === false) return;
    const buffer = pack(msg);
    const msg_to_pub: TopicMessage = {
      type: VSCodePostTypeDefine.PUBLISH_MESSAGE,
      topic: this.topic_,
      payload: buffer,
    };
    VSCode.postMessage(msg_to_pub);
  }

  is_valid() {return this.is_valid_;}
  is_valid_: boolean = false;
  topic_: string;
};