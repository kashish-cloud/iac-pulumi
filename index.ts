import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const vpcCidrBlock = config.require("vpcCidrBlock");
const subnetBaseCidrBlock = config.require("subnetBaseCidrBlock");

// Get data about the current availability zones
const azsData = aws.getAvailabilityZones();

// Create a VPC
const vpc = new aws.ec2.Vpc("myVpc", { 
    cidrBlock: vpcCidrBlock,
    tags: {
        Name: "My VPC"
    }
});

// Create an Internet Gateway and attach it to the VPC
const ig = new aws.ec2.InternetGateway("myIg", { 
    vpcId: vpc.id,
    tags: {
        "Name": "myIg"
    }
});

// Create a public Route Table
const publicRT = new aws.ec2.RouteTable("publicRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "publicRT"
    }
});

// Create a public Route
new aws.ec2.Route("publicRoute", { 
    routeTableId: publicRT.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: ig.id
});

// Create a private Route Table
const privateRT = new aws.ec2.RouteTable("privateRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "privateRT"
    }
});

let firstPublicSubnetId;
let sFinal;
const publicSubnets: pulumi.Output<string>[] = [];

aws.getAvailabilityZones().then(azs => {
    // Create a public and private subnet in each availability zone
    azs.names.forEach((zone, index) => {
        console.log(index)
        if (index < 3) {
            // Create a public subnet
            const publicSubnet = new aws.ec2.Subnet(`publicSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index}.0/24`,
                mapPublicIpOnLaunch: true,
                availabilityZone: zone,
                tags: {
                    "Name": `publicSubnet-${index}`,
                    "Type": "Public"
                }
            });

            // Store the public subnet ID in the list
            publicSubnets.push(publicSubnet.id);

            // Use the first public subnet for the EC2 instance
            if (index === 2) {
                // Print the first public subnet ID
                pulumi.all(publicSubnets).apply(subnetIds => {
                    console.log("First Public Subnet IDs:");
                    firstPublicSubnetId = subnetIds
                    console.log(subnetIds);
                    sFinal = firstPublicSubnetId[0]
                    console.log(sFinal);
                });
            }

            // Create set route table association for the public subnet
            new aws.ec2.RouteTableAssociation(`publicRTA-${index}`, {
                routeTableId: publicRT.id,
                subnetId: publicSubnet.id,
            })

            // Create a private subnet
            const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index + 100}.0/24`,
                availabilityZone: zone,
                tags: {
                    "Name": `privateSubnet-${index}`,
                    "Type": "Private"
                }
            });

            // Create set route table association for the private subnet
            new aws.ec2.RouteTableAssociation(`privateRTA-${index}`, {
                routeTableId: privateRT.id,
                subnetId: privateSubnet.id,
            });
        }
    });

    // Create Security Group
const applicationSecurityGroup = new aws.ec2.SecurityGroup("application", {
    description: "security group for application servers",
    vpcId: vpc.id,
    ingress: [
        { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 8080, toPort: 8080, cidrBlocks: ["0.0.0.0/0"] },
    ]
});

const ami = aws.ec2.getAmi({
    mostRecent: true,
    owners: ["311813075989"],  
    filters: [{
        name: "is-public",      
        values: ["false"]        
    }, {
        name: "state",           
        values: ["available"]    
    },
],
});

// Access the AMI ID from the result
console.log(ami)
const amiId = ami.then(result => result.id);


// Create EC2 Instance
const appEc2Instance = new aws.ec2.Instance("app-instance", {
    instanceType: "t2.micro",
    keyName: "awsKey",
    ami: amiId,
    vpcSecurityGroupIds: [applicationSecurityGroup.id],
    subnetId: publicSubnets[0],
    ebsBlockDevices: [{
        deviceName: "/dev/xvda",
        volumeSize: 25,
        volumeType: "gp2",
        deleteOnTermination: true,
    }],
    disableApiTermination: false,
    availabilityZone: azsData.then(azs => azs.names[0]),
});
});